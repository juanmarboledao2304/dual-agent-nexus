/**
 * @file Lightweight live JSONL transcript watcher for Claude Code (~/.claude/projects) and Google Antigravity (~/.gemini).
 * Extracts real-time token usage, model tier/effort, and subagent spawns, streaming updates via WebSockets.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");
const {
  classifyModelAndEffort,
  computeContextMetrics,
  extractDigestBlock,
  extractGitCheckpoints,
} = require("../utils/modelClassifier");
const { recordOffloadedDigest } = require("./cascadeCacheWatcher");

const POLL_INTERVAL_MS = 4000;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // tail files modified in last 10 minutes

// Map of filePath -> { offset: number, mtimeMs: number }
const fileCursors = new Map();
let watcherInterval = null;

/**
 * Recursively find recent .jsonl files under a directory up to a max depth.
 * @param {string} rootDir
 * @param {number} maxDepth
 * @param {number} cutoffMs
 * @returns {string[]}
 */
function findRecentJsonlFiles(rootDir, maxDepth = 4, cutoffMs = Date.now() - ACTIVE_WINDOW_MS) {
  const results = [];
  if (!rootDir || !fs.existsSync(rootDir)) return results;

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        if (entry.name === "transcript_full.jsonl") continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= cutoffMs) {
            results.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
          }
        } catch {
          // ignore transient file errors
        }
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

/**
 * Read newly appended lines from a JSONL file since the last byte offset.
 * @param {string} filePath
 * @param {number} size
 * @param {number} mtimeMs
 * @returns {object[]}
 */
function readNewJsonlObjects(filePath, size, mtimeMs) {
  const prev = fileCursors.get(filePath);
  if (prev && prev.mtimeMs === mtimeMs && prev.offset === size) {
    return [];
  }

  // On first encounter of an existing file, start near the tail (last 64KB) so we don't replay megabytes of old logs
  let startOffset = prev ? prev.offset : Math.max(0, size - 65536);
  if (size < startOffset) {
    startOffset = 0;
  }

  const lengthToRead = size - startOffset;
  if (lengthToRead <= 0) {
    fileCursors.set(filePath, { offset: size, mtimeMs });
    return [];
  }

  let chunk = "";
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(lengthToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, lengthToRead, startOffset);
    chunk = buffer.toString("utf8", 0, bytesRead);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }

  fileCursors.set(filePath, { offset: size, mtimeMs });

  const lines = chunk.split("\n");
  // If we started mid-file on first read, drop potentially partial first line
  if (!prev && startOffset > 0 && lines.length > 1) {
    lines.shift();
  }

  const parsed = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      parsed.push({ obj: JSON.parse(trimmed), bytes: Buffer.byteLength(trimmed, "utf8") });
    } catch {
      // ignore partial line at tail
    }
  }
  return parsed;
}

/**
 * Process new lines from a Claude Code JSONL transcript.
 */
function processClaudeJsonlEntries(filePath, entries) {
  if (!entries.length) return;
  const baseName = path.basename(filePath, ".jsonl");
  const isSubagentFile =
    filePath.includes(`${path.sep}subagents${path.sep}`) || filePath.includes("/subagents/");
  let sessionId = baseName;
  if (isSubagentFile) {
    // ~/.claude/projects/<slug>/<sessionId>/subagents/<agentId>.jsonl
    const parts = filePath.split(/[\\/]/);
    const subIdx = parts.lastIndexOf("subagents");
    if (subIdx > 0) {
      sessionId = parts[subIdx - 1];
    }
  }

  const session = stmts.getSession.get(sessionId);
  if (!session) return;

  const mainAgentId = `${sessionId}-main`;
  let updated = false;

  for (const { obj, bytes } of entries) {
    const msg = obj.message || obj;
    const model = msg.model || obj.model || session.model;
    const usage = msg.usage || obj.usage || null;
    const effort = obj.effort || msg.effort || session.effort;
    const rawLineText = JSON.stringify(msg.content || obj.content || "");
    const digestInfo = extractDigestBlock(rawLineText, { rawBytes: bytes });
    const gitInfo = extractGitCheckpoints(rawLineText);

    if (usage || model || digestInfo.hasDigest || gitInfo.count > 0) {
      const classified = classifyModelAndEffort({
        provider: "claude",
        model,
        effort,
        isSubagent: isSubagentFile,
      });

      const targetAgentId = isSubagentFile ? baseName : mainAgentId;
      const agent = stmts.getAgent.get(targetAgentId);
      if (agent) {
        const inTok = Number(usage?.input_tokens || 0);
        const outTok = Number(usage?.output_tokens || 0);
        const cacheRead = Number(usage?.cache_read_input_tokens || usage?.cache_read_tokens || 0);
        const cacheWrite = Number(
          usage?.cache_creation_input_tokens || usage?.cache_write_tokens || 0
        );

        const nextIn = (agent.input_tokens || 0) + inTok;
        const nextOut = (agent.output_tokens || 0) + outTok;
        const nextCacheRead = (agent.cache_read_tokens || 0) + cacheRead;
        const nextCacheWrite = (agent.cache_write_tokens || 0) + cacheWrite;
        const nextBytes = (agent.bytes_processed || 0) + bytes;

        const ctx = computeContextMetrics({
          provider: "claude",
          modelTier: classified.model_tier,
          inputTokens: nextIn,
          outputTokens: nextOut,
          cacheReadTokens: nextCacheRead,
          cacheWriteTokens: nextCacheWrite,
          bytesProcessed: nextBytes,
          startedAt: agent.started_at,
        });

        let metaObj = {};
        try {
          metaObj = JSON.parse(agent.metadata || "{}");
        } catch {
          metaObj = {};
        }
        if (digestInfo.hasDigest) {
          metaObj.digest = digestInfo.digestText;
          metaObj.digest_received = true;
          metaObj.offloaded_tokens_saved =
            Number(metaObj.offloaded_tokens_saved || 0) + digestInfo.savedTokens;
          recordOffloadedDigest({
            savedTokens: digestInfo.savedTokens,
            digestText: digestInfo.digestText,
          });
        }
        if (gitInfo.count > 0) {
          const prevCommits = Array.isArray(metaObj.git_commits) ? metaObj.git_commits : [];
          for (const m of gitInfo.messages) {
            if (!prevCommits.includes(m)) prevCommits.push(m);
          }
          metaObj.git_commits = prevCommits;
          metaObj.git_checkpoints = Math.max(
            Number(metaObj.git_checkpoints || 0),
            prevCommits.length,
            gitInfo.count
          );
        }

        stmts.updateAgentTelemetry.run(
          "claude",
          classified.subagent_role,
          classified.model,
          classified.model_tier,
          classified.effort,
          null,
          nextIn,
          nextOut,
          nextCacheRead,
          nextCacheWrite,
          ctx.context_utilization_pct,
          nextBytes,
          ctx.burn_rate_per_hour,
          Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : null,
          null,
          agent.id
        );
        updated = true;
      }
    }
  }

  if (updated) {
    const refreshedMain = stmts.getAgent.get(mainAgentId);
    if (refreshedMain) broadcast("agent_updated", refreshedMain);
  }
}

/**
 * Process new lines from a Google Antigravity transcript.jsonl file.
 */
function processAntigravityJsonlEntries(filePath, entries) {
  if (!entries.length) return;
  // Path pattern: ~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
  const parts = filePath.split(/[\\/]/);
  const brainIdx = parts.lastIndexOf("brain");
  const convId =
    brainIdx >= 0 && parts[brainIdx + 1]
      ? parts[brainIdx + 1]
      : `agy-${path.basename(path.dirname(filePath))}`;

  let hooksRouter = null;
  try {
    hooksRouter = require("../routes/hooks");
  } catch {
    return;
  }
  if (!hooksRouter || typeof hooksRouter.processEvent !== "function") return;

  for (const { obj, bytes } of entries) {
    const stepType = obj.type || "";
    const toolCalls = Array.isArray(obj.tool_calls) ? obj.tool_calls : [];
    const contentStr = String(obj.content || "");

    // Estimate tokens from content + thinking + tool calls
    const contentLen = contentStr.length + String(obj.thinking || "").length;
    const estInputTokens = stepType === "USER_INPUT" ? Math.max(10, Math.round(contentLen / 4)) : 0;
    const estOutputTokens =
      stepType === "PLANNER_RESPONSE" ? Math.max(20, Math.round(contentLen / 4)) : 0;

    if (stepType === "USER_INPUT") {
      hooksRouter.processEvent("UserPromptSubmit", {
        session_id: convId,
        session_name: `Antigravity ${convId.slice(0, 8)}`,
        provider: "antigravity",
        model: obj.model || "argon-4-ultra",
        effort: obj.thinking ? "high" : "medium",
        prompt: contentStr.slice(0, 300),
        output: contentStr,
        transcript_path: filePath,
        metrics: {
          input_tokens: estInputTokens,
          output_tokens: 0,
          bytes_processed: bytes,
        },
      });
    } else if (stepType === "PLANNER_RESPONSE" && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        const toolName = tc.name || tc.tool_name || tc.function?.name || "tool";
        const args = tc.arguments || tc.args || tc.input || {};
        hooksRouter.processEvent("PreToolUse", {
          session_id: convId,
          provider: "antigravity",
          model: obj.model || (obj.thinking ? "argon-4-ultra" : "gemini-3-flow"),
          effort: obj.thinking ? "high" : "medium",
          tool_name: toolName,
          tool_input: args,
          output: contentStr,
          transcript_path: filePath,
          metrics: {
            input_tokens: estInputTokens,
            output_tokens: estOutputTokens,
            bytes_processed: bytes,
          },
        });
      }
    } else if (stepType === "PLANNER_RESPONSE" && contentStr.includes("===DIGEST===")) {
      hooksRouter.processEvent("Stop", {
        session_id: convId,
        provider: "antigravity",
        model: obj.model || "gemini-3.8-flash-high",
        effort: "high",
        output: contentStr,
        summary: "===DIGEST=== Received from Antigravity",
        transcript_path: filePath,
        metrics: {
          input_tokens: estInputTokens,
          output_tokens: estOutputTokens,
          bytes_processed: bytes,
        },
      });
    }
  }
}

/**
 * Single polling pass over active Claude Code and Google Antigravity transcript directories.
 */
function pollLiveTranscripts() {
  try {
    const home = os.homedir();
    const claudeProjectsDir = path.join(home, ".claude", "projects");
    const geminiDir = path.join(home, ".gemini");

    const claudeFiles = findRecentJsonlFiles(claudeProjectsDir, 4);
    for (const file of claudeFiles) {
      const entries = readNewJsonlObjects(file.path, file.size, file.mtimeMs);
      if (entries.length > 0) {
        processClaudeJsonlEntries(file.path, entries);
      }
    }

    const geminiFiles = findRecentJsonlFiles(geminiDir, 5);
    for (const file of geminiFiles) {
      // Avoid feedback loop on our current antigravity conversation if desired, or only process non-empty deltas
      const entries = readNewJsonlObjects(file.path, file.size, file.mtimeMs);
      if (entries.length > 0) {
        processAntigravityJsonlEntries(file.path, entries);
      }
    }
  } catch {
    // Watcher must never crash the server
  }
}

function startLiveTranscriptWatcher() {
  if (process.env.DASHBOARD_LIVE_WATCHER === "0") return null;
  if (process.env.DASHBOARD_DB_PATH && process.env.DASHBOARD_LIVE_WATCHER !== "1") {
    return null;
  }
  if (watcherInterval) return watcherInterval;
  watcherInterval = setInterval(pollLiveTranscripts, POLL_INTERVAL_MS);
  if (watcherInterval.unref) watcherInterval.unref();
  return watcherInterval;
}

function stopLiveTranscriptWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

module.exports = {
  startLiveTranscriptWatcher,
  stopLiveTranscriptWatcher,
  pollLiveTranscripts,
};
