/**
 * @file Deterministic model tier, reasoning effort, subagent role, and context telemetry classifier for Claude Code and Google Antigravity.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const CONTEXT_WINDOWS = {
  claude: {
    heavy: 200000,
    standard: 200000,
    light: 200000,
  },
  "claude-direct": {
    heavy: 200000,
    standard: 200000,
    light: 200000,
  },
  "agy-claude": {
    heavy: 1000000,
    standard: 500000,
    light: 200000,
  },
  "agy-gemini": {
    heavy: 1000000,
    standard: 1000000,
    light: 500000,
  },
  antigravity: {
    heavy: 1000000,
    standard: 1000000,
    light: 500000,
  },
  codex: {
    heavy: 200000,
    standard: 128000,
    light: 128000,
  },
  cursor: {
    heavy: 200000,
    standard: 128000,
    light: 128000,
  },
};

const DEFAULT_CASCADE_MODELS = [
  {
    pool: "agy-claude",
    provider: "agy-claude",
    model: "claude-opus-5-5-high",
    label: "Opus 5.5 High",
    tier: "heavy",
    effort: "high",
  },
  {
    pool: "agy-claude",
    provider: "agy-claude",
    model: "claude-opus-5-5-med",
    label: "Opus 5.5 Med",
    tier: "heavy",
    effort: "medium",
  },
  {
    pool: "agy-claude",
    provider: "agy-claude",
    model: "claude-sonnet-5-5-high",
    label: "Sonnet 5.5 High",
    tier: "standard",
    effort: "high",
  },
  {
    pool: "agy-claude",
    provider: "agy-claude",
    model: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    tier: "standard",
    effort: "medium",
  },
  {
    pool: "agy-gemini",
    provider: "antigravity",
    model: "argon-4-ultra-high",
    label: "Argon / Gemini 4 High",
    tier: "heavy",
    effort: "high",
  },
  {
    pool: "agy-gemini",
    provider: "antigravity",
    model: "gemini-3-pro",
    label: "Gemini Pro",
    tier: "standard",
    effort: "medium",
  },
  {
    pool: "agy-gemini",
    provider: "antigravity",
    model: "gemini-3.8-flash-high",
    label: "Gemini 3.8 Flash High",
    tier: "light",
    effort: "high",
  },
  {
    pool: "agy-gemini",
    provider: "antigravity",
    model: "gemini-3.8-flash-med",
    label: "Gemini 3.8 Flash Med",
    tier: "light",
    effort: "medium",
  },
  {
    pool: "agy-gemini",
    provider: "antigravity",
    model: "gemini-3.8-flash-low",
    label: "Gemini 3.8 Flash Low",
    tier: "light",
    effort: "low",
  },
];

/**
 * Normalize provider string from explicit provider, model name, or source.
 * Supports Pool 1 ('agy-claude'), Pool 2 ('antigravity' / 'agy-gemini'), and Pool 3 ('claude').
 * @param {string} [provider]
 * @param {string} [model]
 * @param {string} [source]
 * @returns {'claude' | 'agy-claude' | 'antigravity' | 'codex' | 'cursor'}
 */
function normalizeProvider(provider, model = "", source = "") {
  const p = String(provider || "")
    .toLowerCase()
    .trim();
  const m = String(model || "")
    .toLowerCase()
    .trim();
  const s = String(source || "")
    .toLowerCase()
    .trim();

  if (p === "agy-claude" || s.includes("agy-claude") || s.includes("claude-pool")) {
    return "agy-claude";
  }

  // Models specific to Pool 1 (Antigravity's Claude / GPT-OSS pool)
  if (
    m.includes("opus-5") ||
    m.includes("opus 5") ||
    m.includes("sonnet-5") ||
    m.includes("sonnet 5") ||
    m.includes("gpt-oss") ||
    m.includes("120b")
  ) {
    return "agy-claude";
  }

  // Claude models explicitly running inside Antigravity / agy-cascade
  if (
    (p === "antigravity" ||
      p === "agy" ||
      s.includes("antigravity") ||
      s.includes("agy-cascade") ||
      s.includes("agy")) &&
    (m.includes("opus") || m.includes("sonnet") || m.includes("claude"))
  ) {
    return "agy-claude";
  }

  if (
    p === "antigravity" ||
    p === "agy-gemini" ||
    p === "agy" ||
    p === "gemini" ||
    p === "google" ||
    s.includes("antigravity") ||
    s.includes("agy") ||
    s.includes("gemini")
  ) {
    return "antigravity";
  }

  if (
    m.includes("gemini") ||
    m.includes("argon") ||
    m.includes("3.8-flash") ||
    m.includes("flash") ||
    m.includes("ultra")
  ) {
    if (p !== "claude" && p !== "claude-direct" && p !== "codex" && p !== "cursor") {
      return "antigravity";
    }
  }

  if (p === "codex" || s.includes("codex")) return "codex";
  if (p === "cursor" || s.includes("cursor")) return "cursor";
  return "claude";
}

/**
 * Resolve which of the 3 Quota Pools an agent/event belongs to.
 * @param {string} [provider]
 * @param {string} [model]
 * @param {string} [source]
 * @returns {'agy-claude' | 'agy-gemini' | 'claude-direct'}
 */
function resolveQuotaPool(provider, model = "", source = "") {
  const norm = normalizeProvider(provider, model, source);
  if (norm === "agy-claude") return "agy-claude";
  if (norm === "antigravity") return "agy-gemini";
  return "claude-direct";
}

/**
 * Normalize reasoning effort value.
 * @param {string} [effort]
 * @returns {'low' | 'medium' | 'high' | 'max' | null}
 */
function normalizeEffortValue(effort) {
  if (!effort) return null;
  const e = String(effort).toLowerCase().trim();
  if (e === "max" || e === "maximum" || e === "xhigh") return "max";
  if (e === "high" || e === "deep" || e === "extended") return "high";
  if (e === "medium" || e === "med" || e === "standard" || e === "normal") return "medium";
  if (e === "low" || e === "light" || e === "fast" || e === "minimal") return "low";
  return null;
}

/**
 * Normalize subagent role into canonical Mission Control roles.
 * @param {object} params
 * @returns {'Main' | 'Explore' | 'Plan' | 'Task' | 'Verifier' | 'Code' | 'Browser' | 'Custom'}
 */
function normalizeSubagentRole({
  subagentType,
  subagentRole,
  toolName,
  isSubagent = false,
  type = "main",
} = {}) {
  const raw = String(subagentRole || subagentType || "")
    .toLowerCase()
    .trim();
  const tool = String(toolName || "")
    .toLowerCase()
    .trim();

  if (!isSubagent && type === "main" && !raw) {
    return "Main";
  }
  if (raw === "main" || raw === "orchestrator" || raw === "primary") {
    return "Main";
  }
  if (
    raw.includes("explore") ||
    raw.includes("research") ||
    raw.includes("search") ||
    raw.includes("fast")
  ) {
    return "Explore";
  }
  if (raw.includes("plan") || raw.includes("architect") || raw.includes("design")) {
    return "Plan";
  }
  if (
    raw.includes("verif") ||
    raw.includes("test") ||
    raw.includes("review") ||
    raw.includes("qa") ||
    raw.includes("audit")
  ) {
    return "Verifier";
  }
  if (
    raw.includes("browser") ||
    raw.includes("web") ||
    raw.includes("playwright") ||
    raw.includes("dom")
  ) {
    return "Browser";
  }
  if (
    raw.includes("code") ||
    raw.includes("implement") ||
    raw.includes("refactor") ||
    raw.includes("general-purpose") ||
    raw.includes("self") ||
    raw.includes("cascade") ||
    raw.includes("delegate")
  ) {
    return "Code";
  }
  if (
    raw.includes("task") ||
    tool === "task" ||
    tool === "dispatch_agent" ||
    tool === "invoke_subagent"
  ) {
    return "Task";
  }
  if (raw) {
    return "Custom";
  }
  return isSubagent || type === "subagent" ? "Task" : "Main";
}

/**
 * Deterministically classify model_tier and effort for Claude Code, Google Antigravity (Pool 1 & Pool 2), Codex, and Cursor.
 * @param {object} input
 * @param {string} [input.provider]
 * @param {string} [input.model]
 * @param {string} [input.effort]
 * @param {string} [input.toolName]
 * @param {string} [input.subagentType]
 * @param {string} [input.subagentRole]
 * @param {boolean} [input.isSubagent]
 * @param {string} [input.type]
 * @param {string} [input.source]
 */
function classifyModelAndEffort(input = {}) {
  const provider = normalizeProvider(input.provider, input.model, input.source);
  const pool = resolveQuotaPool(input.provider, input.model, input.source);
  const rawModel = String(input.model || "").trim();
  const m = rawModel.toLowerCase();
  const inferredEffortFromModel =
    m.endsWith("-high") || m.includes(" high")
      ? "high"
      : m.endsWith("-med") || m.includes(" med") || m.endsWith("-medium")
        ? "medium"
        : m.endsWith("-low") || m.includes(" low")
          ? "low"
          : null;
  const explicitEffort = normalizeEffortValue(input.effort) || inferredEffortFromModel;
  const tool = String(input.toolName || "")
    .toLowerCase()
    .trim();
  const subType = String(input.subagentType || input.subagentRole || "")
    .toLowerCase()
    .trim();
  const isSubagent = Boolean(
    input.isSubagent || input.type === "subagent" || input.parent_agent_id || input.parentAgentId
  );

  const subagent_role = normalizeSubagentRole({
    subagentType: input.subagentType,
    subagentRole: input.subagentRole,
    toolName: input.toolName,
    isSubagent,
    type: input.type || (isSubagent ? "subagent" : "main"),
  });

  // Pool 1: agy-claude (Claude Opus 5.5 High/Med -> Sonnet 5.5 High -> GPT-OSS 120B inside Antigravity)
  if (provider === "agy-claude") {
    const isHeavy =
      m.includes("opus") ||
      (!m.includes("sonnet") &&
        !m.includes("gpt-oss") &&
        !m.includes("120b") &&
        explicitEffort === "max");
    if (isHeavy) {
      const resolvedModel = rawModel || "claude-opus-5-5-high";
      return {
        provider: "agy-claude",
        pool: "agy-claude",
        model: resolvedModel,
        model_short: formatModelShortName(resolvedModel, "agy-claude", "heavy"),
        model_tier: "heavy",
        effort: explicitEffort || "high",
        subagent_role,
      };
    }

    const resolvedModel = rawModel || "claude-sonnet-5-5-high";
    return {
      provider: "agy-claude",
      pool: "agy-claude",
      model: resolvedModel,
      model_short: formatModelShortName(resolvedModel, "agy-claude", "standard"),
      model_tier: "standard",
      effort: explicitEffort || (m.includes("sonnet") ? "high" : "medium"),
      subagent_role,
    };
  }

  // Pool 2: agy-gemini / antigravity (Argon / Gemini 4+ -> Gemini Pro -> Gemini 3.8 Flash High/Med/Low)
  if (provider === "antigravity") {
    const isLightModel =
      m.includes("3.8-flash") ||
      m.includes("flash") ||
      m.includes("lite") ||
      m.includes("nano") ||
      (subType === "explore" && !m.includes("pro") && !m.includes("argon") && !m.includes("ultra"));

    const isHeavyModel =
      m.includes("pro") ||
      m.includes("ultra") ||
      m.includes("argon") ||
      m.includes("gemini-4") ||
      m.includes("gemini 4") ||
      explicitEffort === "high" ||
      explicitEffort === "max";

    if (
      isLightModel ||
      (explicitEffort === "low" && !m.includes("argon") && !m.includes("ultra"))
    ) {
      const resolvedModel = rawModel || "gemini-3.8-flash";
      return {
        provider: "antigravity",
        pool: "agy-gemini",
        model: resolvedModel,
        model_short: formatModelShortName(resolvedModel, "antigravity", "light"),
        model_tier: "light",
        effort: explicitEffort || "low",
        subagent_role,
      };
    }

    if (isHeavyModel) {
      const resolvedModel = rawModel || "argon-4-ultra";
      return {
        provider: "antigravity",
        pool: "agy-gemini",
        model: resolvedModel,
        model_short: formatModelShortName(resolvedModel, "antigravity", "heavy"),
        model_tier: "heavy",
        effort: explicitEffort === "max" ? "max" : "high",
        subagent_role,
      };
    }

    // Standard flow agent -> model_tier: 'standard', effort: 'medium'
    const resolvedModel = rawModel || "gemini-3-flow";
    return {
      provider: "antigravity",
      pool: "agy-gemini",
      model: resolvedModel,
      model_short: formatModelShortName(resolvedModel, "antigravity", "standard"),
      model_tier: "standard",
      effort: explicitEffort || "medium",
      subagent_role,
    };
  }

  // Pool 3: Claude Direct (and fallback) Classification
  const isExploreDispatch =
    (tool === "task" || tool === "dispatch_agent" || tool === "agent" || isSubagent) &&
    (subType === "explore" || subagent_role === "Explore") &&
    !m.includes("opus") &&
    !m.includes("sonnet");

  if (
    m.includes("haiku") ||
    isExploreDispatch ||
    (explicitEffort === "low" && !m.includes("opus") && !m.includes("sonnet"))
  ) {
    const resolvedModel = rawModel || "claude-haiku-4-5";
    return {
      provider,
      pool,
      model: resolvedModel,
      model_short: formatModelShortName(resolvedModel, provider, "light"),
      model_tier: "light",
      effort: explicitEffort || "low",
      subagent_role,
    };
  }

  if (m.includes("opus") || explicitEffort === "high" || explicitEffort === "max") {
    const resolvedModel = rawModel || "claude-opus-4-6";
    return {
      provider,
      pool,
      model: resolvedModel,
      model_short: formatModelShortName(resolvedModel, provider, "heavy"),
      model_tier: "heavy",
      effort: explicitEffort === "max" ? "max" : "high",
      subagent_role,
    };
  }

  // Default Claude Sonnet -> standard, medium
  const resolvedModel = rawModel || "claude-sonnet-4-6";
  return {
    provider,
    pool,
    model: resolvedModel,
    model_short: formatModelShortName(resolvedModel, provider, "standard"),
    model_tier: "standard",
    effort: explicitEffort || "medium",
    subagent_role,
  };
}

/**
 * Format a compact badge-ready model name for UI cards.
 * @param {string} [model]
 * @param {string} [provider]
 * @param {'heavy' | 'standard' | 'light'} [modelTier]
 * @returns {string}
 */
function formatModelShortName(model = "", provider = "claude", modelTier = "standard") {
  const m = String(model || "")
    .toLowerCase()
    .trim();
  const p = String(provider || "claude").toLowerCase();

  if (p === "agy-claude") {
    if (m.includes("gpt-oss") || m.includes("120b")) return "GPT-OSS 120B";
    if (m.includes("opus")) {
      if (m.includes("5-5") || m.includes("5.5")) return "Opus 5.5";
      return "Opus 5.5";
    }
    if (m.includes("sonnet")) {
      if (m.includes("5-5") || m.includes("5.5")) return "Sonnet 5.5";
      return "Sonnet 5.5";
    }
    return modelTier === "heavy" ? "Opus 5.5" : "Sonnet 5.5";
  }

  if (p === "antigravity" || p === "agy-gemini") {
    if (m.includes("argon")) return "Argon 4";
    if (m.includes("gemini-4") || m.includes("gemini 4")) return "Gemini 4";
    if (m.includes("ultra")) return "Gemini Ultra";
    if (m.includes("3.8-flash") || m.includes("3.8")) return "3.8 Flash";
    if (m.includes("flash-lite") || m.includes("lite")) return "Flash Lite";
    if (m.includes("flash")) return "3.8 Flash";
    if (m.includes("pro")) return "Gemini 3 Pro";
    if (m.includes("flow")) return "Agy Flow";
    if (modelTier === "heavy") return "Argon 4";
    if (modelTier === "light") return "3.8 Flash";
    return "Gemini 3 Std";
  }

  if (m.includes("opus")) {
    if (m.includes("5-5") || m.includes("5.5")) return "Opus 5.5";
    if (m.includes("4-6") || m.includes("4.6")) return "Opus 4.6";
    if (m.includes("4-5") || m.includes("4.5")) return "Opus 4.5";
    return "Opus 4.6";
  }
  if (m.includes("haiku")) {
    if (m.includes("4-5") || m.includes("4.5")) return "Haiku 4.5";
    if (m.includes("3-5") || m.includes("3.5")) return "Haiku 3.5";
    return "Haiku 4.5";
  }
  if (m.includes("sonnet")) {
    if (m.includes("5-5") || m.includes("5.5")) return "Sonnet 5.5";
    if (m.includes("4-6") || m.includes("4.6")) return "Sonnet 4.6";
    if (m.includes("4-5") || m.includes("4.5")) return "Sonnet 4.5";
    return "Sonnet 4.6";
  }

  if (modelTier === "heavy") return "Opus 4.6";
  if (modelTier === "light") return "Haiku 4.5";
  return "Sonnet 4.6";
}

/**
 * Map hook event type and agent state to canonical telemetry status and legacy DB status.
 * @param {object} params
 * @returns {{ telemetryStatus: 'spawning' | 'thinking' | 'tool_use' | 'waiting_approval' | 'completed' | 'error', dbStatus: 'working' | 'waiting' | 'completed' | 'error' }}
 */
function mapTelemetryStatus({
  hookType = "",
  status = "",
  currentTool = null,
  awaitingInput = false,
} = {}) {
  const s = String(status || "")
    .toLowerCase()
    .trim();
  const h = String(hookType || "").trim();

  if (s === "error" || s === "failed" || h === "PreToolUseFailure" || h === "PostToolUseFailure") {
    return { telemetryStatus: "error", dbStatus: "error" };
  }
  if (
    s === "completed" ||
    s === "done" ||
    h === "Stop" ||
    h === "SubagentStop" ||
    h === "SessionEnd"
  ) {
    return { telemetryStatus: "completed", dbStatus: "completed" };
  }
  if (
    s === "waiting_approval" ||
    s === "waiting" ||
    awaitingInput ||
    h === "PermissionRequest" ||
    h === "Notification"
  ) {
    return { telemetryStatus: "waiting_approval", dbStatus: "waiting" };
  }
  if (s === "spawning" || h === "SubagentStart" || h === "SessionStart") {
    return { telemetryStatus: "spawning", dbStatus: "working" };
  }
  if (s === "tool_use" || h === "PreToolUse" || Boolean(currentTool)) {
    return { telemetryStatus: "tool_use", dbStatus: "working" };
  }
  if (s === "thinking" || s === "working" || h === "UserPromptSubmit" || h === "PostToolUse") {
    return { telemetryStatus: "thinking", dbStatus: "working" };
  }
  return { telemetryStatus: "thinking", dbStatus: "working" };
}

/**
 * Calculate context utilization percentage and hourly burn rate.
 * @param {object} params
 */
function computeContextMetrics({
  provider = "claude",
  modelTier = "standard",
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  bytesProcessed = 0,
  startedAt = null,
} = {}) {
  const p = normalizeProvider(provider);
  const tier = ["heavy", "standard", "light"].includes(modelTier) ? modelTier : "standard";
  const maxContext = (CONTEXT_WINDOWS[p] && CONTEXT_WINDOWS[p][tier]) || 200000;

  const totalContextTokens =
    Number(inputTokens || 0) +
    Number(outputTokens || 0) +
    Number(cacheReadTokens || 0) +
    Number(cacheWriteTokens || 0) +
    Math.round(Number(bytesProcessed || 0) / 4);

  const contextUtilizationPct = Math.min(
    100,
    Math.round((totalContextTokens / maxContext) * 1000) / 10
  );

  let elapsedHours = 1 / 60; // minimum 1 minute denominator to avoid spike on spawn
  if (startedAt) {
    const startMs = new Date(startedAt).getTime();
    if (!Number.isNaN(startMs)) {
      const diffHours = (Date.now() - startMs) / 3600000;
      if (diffHours > 1 / 60) {
        elapsedHours = diffHours;
      }
    }
  }

  const burnRatePerHour = Math.round(totalContextTokens / elapsedHours);
  const totalInputWithCache =
    Number(inputTokens || 0) + Number(cacheReadTokens || 0) + Number(cacheWriteTokens || 0);
  const cacheHitRatePct =
    totalInputWithCache > 0
      ? Math.round((Number(cacheReadTokens || 0) / totalInputWithCache) * 1000) / 10
      : 0;

  return {
    context_utilization_pct: contextUtilizationPct,
    burn_rate_per_hour: burnRatePerHour,
    cache_hit_rate_pct: cacheHitRatePct,
    max_context_tokens: maxContext,
    total_tokens: totalContextTokens,
  };
}

/**
 * Detect and extract a `===DIGEST===` block from tool output or transcript content,
 * calculating how many raw execution tokens were offloaded from the main Claude context.
 * @param {string} [text]
 * @param {{ rawBytes?: number, toolCallCount?: number, explicitSavedTokens?: number }} [options]
 */
function extractDigestBlock(text = "", options = {}) {
  const raw = String(text || "");
  const markerIndex = raw.indexOf("===DIGEST===");
  if (markerIndex === -1) {
    return {
      hasDigest: false,
      digestText: null,
      digestTokens: 0,
      estimatedRawTokens: 0,
      savedTokens: 0,
    };
  }

  const afterMarker = raw.slice(markerIndex + "===DIGEST===".length);
  const endMarkerMatch = afterMarker.match(/===(?:END_DIGEST|\/DIGEST)===/i);
  const digestText = (
    endMarkerMatch ? afterMarker.slice(0, endMarkerMatch.index) : afterMarker
  ).trim();

  const digestTokens = Math.max(24, Math.ceil(digestText.length / 4));
  const precedingChars = markerIndex;
  const rawBytes = Number(options.rawBytes || 0);
  const toolCallCount = Number(options.toolCallCount || 0);

  const estimatedRawTokens =
    Number(options.explicitSavedTokens || 0) > 0
      ? Number(options.explicitSavedTokens) + digestTokens
      : Math.max(
          digestTokens * 18,
          Math.ceil(precedingChars / 4) + Math.ceil(rawBytes / 4) + toolCallCount * 1650 + 14200
        );

  const savedTokens = Math.max(0, estimatedRawTokens - digestTokens);

  return {
    hasDigest: true,
    digestText,
    digestTokens,
    estimatedRawTokens,
    savedTokens,
  };
}

/**
 * Detect git commit checkpoints from Bash command strings or tool outputs.
 * @param {string} [text]
 * @returns {{ count: number, messages: string[], hashes: string[] }}
 */
function extractGitCheckpoints(text = "") {
  const raw = String(text || "");
  if (!raw) return { count: 0, messages: [], hashes: [] };

  const messages = [];
  const hashes = [];

  // Match `git commit ... -m "..."` or `git commit ... -m '...'`
  const cmdRegex = /git\s+commit\b[^;\n]*?-m\s+(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
  let match;
  while ((match = cmdRegex.exec(raw)) !== null) {
    const msg = (match[1] || match[2] || match[3] || "").trim();
    if (msg && !messages.includes(msg)) {
      messages.push(msg);
    }
  }

  // Match standard git commit output: `[branch abc1234] commit message`
  const outRegex = /\[[\w./-]+\s+([0-9a-f]{7,40})\]\s+([^\r\n]+)/gi;
  while ((match = outRegex.exec(raw)) !== null) {
    const hash = match[1].slice(0, 7);
    const msg = match[2].trim();
    if (hash && !hashes.includes(hash)) hashes.push(hash);
    if (msg && !messages.includes(msg)) messages.push(msg);
  }

  const count = Math.max(messages.length, hashes.length);
  return { count, messages, hashes };
}

/**
 * Parse a Bash command string to detect Cross-CLI delegation (`agy-cascade`, `agy-delegate`, `agy-job`, `agy-trace`).
 * @param {string} [commandStr]
 */
function parseAgyBridgeCommand(commandStr = "") {
  const cmd = String(commandStr || "").trim();
  if (!cmd) return null;

  const bridgeMatch = cmd.match(
    /(?:^|[;&|]\s*|\b)(agy-cascade|agy-delegate|agy-job|agy-trace)\b([\s\S]*)$/i
  );
  if (!bridgeMatch) return null;

  const bridgeTool = bridgeMatch[1].toLowerCase();
  const argsStr = bridgeMatch[2] || "";

  const dirMatch = argsStr.match(/(?:--dir|-C)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const timeoutMatch = argsStr.match(/--timeout\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const modelMatch = argsStr.match(/(?:--model|-m)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  const poolMatch = argsStr.match(/--pool\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);

  const yolo = /--yolo\b/i.test(argsStr);
  const digest = /--digest\b/i.test(argsStr) || cmd.includes("===DIGEST===");
  const isFanOut = /define_subagent|invoke_subagent|fan-out|fanout/i.test(cmd);

  // Extract trailing quoted prompt if present
  let prompt = "";
  const quotedPrompts = [...argsStr.matchAll(/"([^"]{8,})"|'([^']{8,})'/g)];
  if (quotedPrompts.length > 0) {
    const lastMatch = quotedPrompts[quotedPrompts.length - 1];
    prompt = (lastMatch[1] || lastMatch[2] || "").trim();
  } else {
    prompt = argsStr
      .replace(/--(?:yolo|digest)\b/gi, "")
      .replace(/(?:--dir|-C|--timeout|--model|-m|--pool)\s+\S+/gi, "")
      .trim();
  }

  const explicitModel = modelMatch ? modelMatch[1] || modelMatch[2] || modelMatch[3] : "";
  const explicitPool = poolMatch ? poolMatch[1] || poolMatch[2] || poolMatch[3] : "";

  return {
    bridgeTool,
    workspaceDir: dirMatch ? dirMatch[1] || dirMatch[2] || dirMatch[3] : null,
    timeout: timeoutMatch ? timeoutMatch[1] || timeoutMatch[2] || timeoutMatch[3] : null,
    yolo,
    digest,
    isFanOut,
    model: explicitModel || null,
    pool: explicitPool || null,
    prompt: prompt.slice(0, 500),
    rawCommand: cmd.slice(0, 1000),
  };
}

module.exports = {
  CONTEXT_WINDOWS,
  DEFAULT_CASCADE_MODELS,
  normalizeProvider,
  resolveQuotaPool,
  normalizeEffortValue,
  normalizeSubagentRole,
  classifyModelAndEffort,
  formatModelShortName,
  mapTelemetryStatus,
  computeContextMetrics,
  extractDigestBlock,
  extractGitCheckpoints,
  parseAgyBridgeCommand,
};
