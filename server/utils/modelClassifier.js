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

/**
 * Normalize provider string from explicit provider, model name, or source.
 * @param {string} [provider]
 * @param {string} [model]
 * @param {string} [source]
 * @returns {'claude' | 'antigravity' | 'codex' | 'cursor'}
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

  if (
    p === "antigravity" ||
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
    if (p !== "claude" && p !== "codex" && p !== "cursor") {
      return "antigravity";
    }
  }

  if (p === "codex" || s.includes("codex")) return "codex";
  if (p === "cursor" || s.includes("cursor")) return "cursor";
  return "claude";
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
    raw.includes("self")
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
 * Deterministically classify model_tier and effort for Claude Code, Google Antigravity, Codex, and Cursor.
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
  const rawModel = String(input.model || "").trim();
  const m = rawModel.toLowerCase();
  const explicitEffort = normalizeEffortValue(input.effort);
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

  if (provider === "antigravity") {
    // Google Antigravity Classification
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
      explicitEffort === "high" ||
      explicitEffort === "max";

    if (isLightModel || explicitEffort === "low") {
      const resolvedModel = rawModel || "gemini-3.8-flash";
      return {
        provider: "antigravity",
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
      model: resolvedModel,
      model_short: formatModelShortName(resolvedModel, "antigravity", "standard"),
      model_tier: "standard",
      effort: explicitEffort || "medium",
      subagent_role,
    };
  }

  // Claude Code (and fallback) Classification
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

  if (p === "antigravity") {
    if (m.includes("argon")) return "Argon 4";
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

module.exports = {
  CONTEXT_WINDOWS,
  normalizeProvider,
  normalizeEffortValue,
  normalizeSubagentRole,
  classifyModelAndEffort,
  formatModelShortName,
  mapTelemetryStatus,
  computeContextMetrics,
};
