/**
 * @file Live sync with Claude Code's own session registry. Every running Claude Code process writes
 * `<CLAUDE_HOME>/sessions/<pid>.json` (sessionId, name, kind, and a live status: busy / idle /
 * waiting + waitingFor), and every background job keeps `<CLAUDE_HOME>/jobs/<jobId>/state.json`
 * (working / blocked / done / failed ...). Hooks alone cannot tell a finished job from an idle
 * prompt, and on Windows there is no process probe at all, so sessions drifted: finished jobs stayed
 * "working", idle prompts showed as "asks for approval", jobs asking for a reply never surfaced, and
 * dead sessions stayed active. This module reads that registry, reopens a closed row whose process
 * is still alive (unless its job is finished), and steers active session rows to
 * the state Claude Code itself reports. It only writes when something actually changed. It also
 * repairs Claude Code sessions that were mislabelled as Antigravity Pool 1 (agy-claude).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("node:fs");
const path = require("node:path");
const { getClaudeHome, isClaudeProjectsTranscript } = require("./claude-home");

/** Names the dashboard invents when it knows nothing better. */
const GENERIC_NAME = /^(?:Session|Main Agent - Session) [0-9a-f]{8}$/i;
/** Job states that mean the job is over (process may linger idle). */
const JOB_DONE = new Set(["done", "stopped", "killed"]);
const JOB_FAILED = new Set(["failed", "error"]);
/** Job state that means the job asked the human for a reply. */
const JOB_BLOCKED = "blocked";
/** Registry entries younger than this are left alone so a just-fired hook is not overridden. */
const SETTLE_MS = 2_000;

/** True when a process with this pid exists (EPERM still means it exists). */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

/** Read `jobs/<jobId>/state.json`; null when missing or unreadable. */
function readJobState(home, jobId) {
  if (typeof jobId !== "string" || !/^[\w-]+$/.test(jobId)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, "jobs", jobId, "state.json"), "utf8"));
    return {
      state: typeof raw.state === "string" ? raw.state : null,
      detail: typeof raw.detail === "string" ? raw.detail : null,
    };
  } catch {
    return null;
  }
}

/**
 * True when the registry must not be consulted: explicitly disabled, or a test run that did not
 * point CLAUDE_HOME at a fixture (it would otherwise read the developer's real sessions).
 */
function registryDisabled(env = process.env) {
  const raw = String(env.DASHBOARD_LIVENESS_PROBE || "")
    .trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return true;
  if (env.NODE_TEST_CONTEXT && !env.CLAUDE_HOME) return true;
  return false;
}

/**
 * Read the live Claude Code sessions.
 *
 * @param {{ home?: string, isAlive?: (pid: number) => boolean, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ available: boolean, sessions: Map<string, object> }} `available: false` means "no
 *   trustworthy answer" (registry missing or disabled) and callers must change nothing.
 */
function readLiveClaudeSessions({ home, isAlive = isPidAlive, env = process.env } = {}) {
  const empty = { available: false, sessions: new Map() };
  if (registryDisabled(env)) return empty;
  const root = home || getClaudeHome();
  let files;
  try {
    files = fs.readdirSync(path.join(root, "sessions"));
  } catch {
    return empty;
  }
  const sessions = new Map();
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(root, "sessions", file), "utf8"));
    } catch {
      continue; // being rewritten right now — next tick
    }
    if (!entry || typeof entry.sessionId !== "string" || !Number.isInteger(entry.pid)) continue;
    if (!isAlive(entry.pid)) continue; // stale file left by a crashed process
    const job = readJobState(root, entry.jobId);
    sessions.set(entry.sessionId, {
      sessionId: entry.sessionId,
      pid: entry.pid,
      kind: typeof entry.kind === "string" ? entry.kind : null,
      status: typeof entry.status === "string" ? entry.status : null,
      waitingFor: typeof entry.waitingFor === "string" ? entry.waitingFor : null,
      statusUpdatedAt: Number(entry.statusUpdatedAt) || 0,
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      nameSource: typeof entry.nameSource === "string" ? entry.nameSource : null,
      jobId: typeof entry.jobId === "string" ? entry.jobId : null,
      jobState: job?.state || null,
      jobDetail: job?.detail || null,
      cwd: typeof entry.cwd === "string" ? entry.cwd : null,
      spare: entry.spare === true,
    });
  }
  return { available: true, sessions };
}

/**
 * What the dashboard should show for one live registry entry.
 *
 * @returns {{ kind: 'working' } | { kind: 'waiting', reason: string, telemetry: string }
 *   | { kind: 'completed' | 'error' } | null} null when the entry says nothing usable.
 */
function deriveLiveState(entry) {
  if (entry.status === "busy") return { kind: "working" };
  if (entry.jobState === JOB_BLOCKED) {
    return { kind: "waiting", reason: "job_blocked", telemetry: "waiting_input" };
  }
  if (entry.status === "waiting") {
    // A permission prompt or dialog is open in the CLI.
    return { kind: "waiting", reason: "notification", telemetry: "waiting_approval" };
  }
  if (entry.status !== "idle") return null;
  if (JOB_DONE.has(entry.jobState)) return { kind: "completed" };
  if (JOB_FAILED.has(entry.jobState)) return { kind: "error" };
  return { kind: "waiting", reason: "stop", telemetry: "waiting_input" };
}

/**
 * The registry's name for a session when it should replace the stored one, else null. A name the
 * user or Claude Code chose wins; a name derived from the folder only replaces a generic fallback.
 */
function preferredName(entry, current) {
  const name = entry.name;
  if (!name || name.length > 200) return null;
  if (name === entry.sessionId.slice(0, 8) || name === entry.jobId) return null;
  if (name === current) return null;
  if (entry.nameSource === "derived" && current && !GENERIC_NAME.test(current)) return null;
  return name;
}

/**
 * Build the sync pass bound to the dashboard database.
 *
 * @param {{ db: object, stmts: object, broadcast: Function, readRegistry?: Function, now?: () => number }} deps
 * @returns {() => { available: boolean, changed: number }} One sync pass.
 */
function createClaudeLiveSync({
  db,
  stmts,
  broadcast,
  readRegistry = readLiveClaudeSessions,
  now = Date.now,
}) {
  // Telemetry status only; leaves updated_at alone so a no-op sync never looks like activity.
  const setTelemetry = db.prepare(
    "UPDATE agents SET telemetry_status = ? WHERE id = ? AND COALESCE(telemetry_status, '') <> ?"
  );

  return function syncClaudeLiveState() {
    const registry = readRegistry();
    if (!registry.available) return { available: false, changed: 0 };
    let changed = 0;

    for (const entry of registry.sessions.values()) {
      if (entry.spare) continue;
      let session = stmts.getSession.get(entry.sessionId);
      if (!session || (session.provider || "claude") !== "claude") continue;

      let sessionTouched = false;
      const touchedAgents = new Set();
      const events = [];

      const name = preferredName(entry, session.name);
      if (name && stmts.updateSessionName.run(name, session.id, name).changes > 0) {
        sessionTouched = true;
      }

      const settled = !entry.statusUpdatedAt || now() - entry.statusUpdatedAt >= SETTLE_MS;

      // A row closed by a startup import or a stale sweep while its process is still alive (an
      // open terminal idle at its prompt) is live again. A finished job stays closed.
      if ((session.status === "completed" || session.status === "abandoned") && settled) {
        const state = deriveLiveState(entry);
        if (state && state.kind !== "completed" && state.kind !== "error") {
          stmts.reactivateSession.run(session.id);
          if (stmts.getAgent.get(`${session.id}-main`)) {
            stmts.reactivateAgent.run(`${session.id}-main`);
            touchedAgents.add(`${session.id}-main`);
          }
          session = stmts.getSession.get(session.id);
          sessionTouched = true;
        }
      }

      const live = session.status === "active" && settled ? deriveLiveState(entry) : null;
      const mainId = `${session.id}-main`;
      const main = stmts.getAgent.get(mainId);
      const ts = new Date(now()).toISOString();

      if (live && (live.kind === "completed" || live.kind === "error")) {
        stmts.clearSessionAgentsAwaitingInput.run(session.id);
        stmts.clearSessionAwaitingInput.run(session.id);
        for (const agent of stmts.listAgentsBySession.all(session.id)) {
          if (agent.status !== "completed" && agent.status !== "error") {
            stmts.updateAgent.run(null, live.kind, null, null, ts, null, agent.id);
            touchedAgents.add(agent.id);
          }
        }
        stmts.updateSession.run(null, live.kind, ts, null, session.id);
        sessionTouched = true;
        const label = name || session.name || `Session ${session.id.slice(0, 8)}`;
        const summary = `Job ${entry.jobState}: ${label}${entry.jobDetail ? ` — ${entry.jobDetail.slice(0, 160)}` : ""}`;
        stmts.insertEvent.run(
          session.id,
          main ? mainId : null,
          "SessionEnd",
          null,
          summary,
          JSON.stringify({
            session_id: session.id,
            source: "claude-registry",
            job_state: entry.jobState,
          })
        );
        events.push({
          agent_id: main ? mainId : null,
          event_type: "SessionEnd",
          summary,
          created_at: ts,
        });
      } else if (live && live.kind === "working") {
        if (
          main &&
          main.status !== "working" &&
          main.status !== "completed" &&
          main.status !== "error"
        ) {
          stmts.updateAgent.run(
            null,
            "working",
            null,
            main.current_tool ?? null,
            null,
            null,
            mainId
          );
          touchedAgents.add(mainId);
        }
        if (session.awaiting_input_since) {
          stmts.clearSessionAgentsAwaitingInput.run(session.id);
          stmts.clearSessionAwaitingInput.run(session.id);
          sessionTouched = true;
          if (main) touchedAgents.add(mainId);
        }
        if (main && /^waiting_/.test(String(main.telemetry_status || ""))) {
          if (setTelemetry.run("thinking", mainId, "thinking").changes > 0)
            touchedAgents.add(mainId);
        }
      } else if (live && live.kind === "waiting") {
        if (
          main &&
          main.status !== "waiting" &&
          main.status !== "completed" &&
          main.status !== "error"
        ) {
          stmts.updateAgent.run(null, "waiting", null, null, null, null, mainId);
          touchedAgents.add(mainId);
        }
        if (session.awaiting_reason !== live.reason || !session.awaiting_input_since) {
          const since = session.awaiting_input_since || ts;
          stmts.setSessionAwaitingInput.run(since, live.reason, session.id);
          if (main) stmts.setAgentAwaitingInput.run(since, live.reason, mainId);
          sessionTouched = true;
          if (main) touchedAgents.add(mainId);
        }
        if (main && setTelemetry.run(live.telemetry, mainId, live.telemetry).changes > 0) {
          touchedAgents.add(mainId);
        }
      }

      if (sessionTouched || touchedAgents.size > 0) {
        changed += 1;
        broadcast("session_updated", stmts.getSession.get(session.id));
        for (const id of touchedAgents) broadcast("agent_updated", stmts.getAgent.get(id));
        for (const event of events)
          broadcast("new_event", { session_id: session.id, tool_name: null, ...event });
      }
    }
    return { available: true, changed };
  };
}

/**
 * One-off, idempotent repair: Claude Code sessions on an Opus/Sonnet 5.x model used to be
 * labelled `agy-claude` (Antigravity Pool 1) because Claude Code's hooks carry a model but no
 * provider. A transcript under <CLAUDE_HOME>/projects proves the session is Claude Code, so
 * relabel the session and its main agent as `claude`.
 *
 * @returns {number} Sessions relabelled.
 */
function repairClaudeProviderLabels(db) {
  const rows = db
    .prepare(
      "SELECT id, transcript_path FROM sessions WHERE provider = 'agy-claude' AND transcript_path IS NOT NULL"
    )
    .all();
  const setSession = db.prepare("UPDATE sessions SET provider = 'claude' WHERE id = ?");
  const setMain = db.prepare(
    "UPDATE agents SET provider = 'claude' WHERE id = ? AND provider = 'agy-claude'"
  );
  let fixed = 0;
  for (const row of rows) {
    if (!isClaudeProjectsTranscript(row.transcript_path)) continue;
    setSession.run(row.id);
    setMain.run(`${row.id}-main`);
    fixed += 1;
  }
  return fixed;
}

module.exports = {
  repairClaudeProviderLabels,
  readLiveClaudeSessions,
  deriveLiveState,
  preferredName,
  createClaudeLiveSync,
  isPidAlive,
  registryDisabled,
};
