/**
 * @file Dual-Subscription Quota Telemetry & One-Click 25-Second Swarm Simulator for Claude Code and Google Antigravity.
 * Powers the quota meter and Usage page and POST /api/simulate/swarm. The swarm drives every Agent Rooms zone
 * and the 3-level Cascade Hierarchy: L1 Opus Conductor -> L2 agy-cascade bridge on Pool 1 Opus 5.5
 * Thinking -> Exit Code 10 -> Pool 2 Argon 4 Ultra -> 3x L3 Gemini 3.8 Flash specialists -> git
 * checkpoints and a ===DIGEST=== token-offload summary. Along the way it raises each Attention Radar
 * signal once (a 4x Grep loop, Exit Code 10 quota exhaustion, and a y/n permission prompt) and
 * streams per-agent stdout so every workstation pod's mini-terminal fills in.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { db, stmts } = require("../db");
const { broadcast } = require("../websocket");
const hooksRouter = require("../routes/hooks");
const {
  getCascadeStatus,
  triggerSimulatedExhaustion,
  clearSimulatedExhaustion,
} = require("../watchers/cascadeCacheWatcher");

const router = Router();

let activeSimulation = null;

/**
 * Write one synthetic hook event for a specific agent and broadcast it, bypassing the hook
 * router's actor heuristics so the simulation can target an exact pod (used for the loop demo).
 */
function emitAgentEvent(sessionId, agentId, eventType, toolName, summary) {
  stmts.insertEvent.run(sessionId, agentId, eventType, toolName, summary, null);
  broadcast("new_event", {
    session_id: sessionId,
    agent_id: agentId,
    event_type: eventType,
    tool_name: toolName,
    summary,
    created_at: new Date().toISOString(),
  });
}

/** Broadcast one stdout/stderr line attributed to an agent, for the pods' mini-terminals. */
function emitAgentStream(dispatchId, sessionId, agentId, provider, line, stream = "stdout") {
  broadcast("dispatch_stream", {
    dispatch_id: dispatchId,
    session_id: sessionId,
    agent_id: agentId,
    provider,
    stream,
    line,
    chunk: line + "\n",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Compute real-time Dual Subscription Quota telemetry for Left Wing (Claude Code),
 * Right Wing (Google Antigravity), and the 3-Pool `agy-cascade` Waterfall.
 */
function getDualQuotaTelemetry() {
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();

  // Left Wing: Claude Code 5h rolling window usage + active subagent breakdown by thermal tier
  const claudeTokenRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(t.input_tokens + t.baseline_input), 0) AS input_tokens,
         COALESCE(SUM(t.output_tokens + t.baseline_output), 0) AS output_tokens,
         COALESCE(SUM(t.cache_read_tokens + t.baseline_cache_read), 0) AS cache_read_tokens,
         COALESCE(SUM(t.cache_write_tokens + t.baseline_cache_write), 0) AS cache_write_tokens
       FROM token_usage t
       JOIN sessions s ON s.id = t.session_id
       WHERE COALESCE(s.provider, 'claude') IN ('claude', 'cursor')
         AND s.updated_at >= ?`
    )
    .get(fiveHoursAgo) || {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };

  const claudeAgentTokens = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens
       FROM agents
       WHERE COALESCE(provider, 'claude') = 'claude'
         AND updated_at >= ?`
    )
    .get(fiveHoursAgo) || {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };

  const claudeInput = Math.max(
    Number(claudeTokenRow.input_tokens || 0),
    Number(claudeAgentTokens.input_tokens || 0)
  );
  const claudeOutput = Math.max(
    Number(claudeTokenRow.output_tokens || 0),
    Number(claudeAgentTokens.output_tokens || 0)
  );
  const claudeCacheRead = Math.max(
    Number(claudeTokenRow.cache_read_tokens || 0),
    Number(claudeAgentTokens.cache_read_tokens || 0)
  );
  const claudeCacheWrite = Math.max(
    Number(claudeTokenRow.cache_write_tokens || 0),
    Number(claudeAgentTokens.cache_write_tokens || 0)
  );

  const claudeTotal5h = claudeInput + claudeOutput;
  const claudeTotalInputWithCache = claudeInput + claudeCacheRead + claudeCacheWrite;
  const claudeCacheEfficiencyPct =
    claudeTotalInputWithCache > 0
      ? Math.round((claudeCacheRead / claudeTotalInputWithCache) * 1000) / 10
      : 74.2;

  const claudeTierRows = db
    .prepare(
      `SELECT COALESCE(model_tier, 'standard') AS tier, COUNT(*) AS count
       FROM agents
       WHERE COALESCE(provider, 'claude') = 'claude'
         AND status IN ('working', 'waiting')
       GROUP BY COALESCE(model_tier, 'standard')`
    )
    .all();

  const claudeTiers = { heavy: 0, standard: 0, light: 0 };
  for (const r of claudeTierRows) {
    if (r.tier in claudeTiers) claudeTiers[r.tier] = r.count;
  }

  const claudeCap5h = 2500000; // 2.5M 5h rolling window cap
  const claudeBurnPerHour =
    Math.round(claudeTotal5h / 5) ||
    claudeTiers.heavy * 65000 + claudeTiers.standard * 32000 + claudeTiers.light * 12000;
  const claudeRemainingTokens = Math.max(0, claudeCap5h - claudeTotal5h);
  const claudeHoursToCap =
    claudeBurnPerHour > 0
      ? Math.round((claudeRemainingTokens / claudeBurnPerHour) * 10) / 10
      : null;

  // Right Wing: Google Antigravity (Pool 1 agy-claude + Pool 2 agy-gemini/antigravity) 5h rolling window + flow telemetry
  const agyAgentTokens = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(bytes_processed), 0) AS bytes_processed
       FROM agents
       WHERE provider IN ('antigravity', 'agy-claude', 'agy-gemini')
         AND updated_at >= ?`
    )
    .get(fiveHoursAgo) || {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    bytes_processed: 0,
  };

  const agyTierRows = db
    .prepare(
      `SELECT COALESCE(model_tier, 'standard') AS tier, COUNT(*) AS count
       FROM agents
       WHERE provider IN ('antigravity', 'agy-claude', 'agy-gemini')
         AND status IN ('working', 'waiting')
       GROUP BY COALESCE(model_tier, 'standard')`
    )
    .all();

  const agyTiers = { heavy: 0, standard: 0, light: 0 };
  for (const r of agyTierRows) {
    if (r.tier in agyTiers) agyTiers[r.tier] = r.count;
  }

  const agyAllModelRows = db
    .prepare(
      `SELECT COALESCE(model_tier, 'standard') AS tier, COUNT(*) AS count
       FROM agents
       WHERE provider IN ('antigravity', 'agy-claude', 'agy-gemini')
       GROUP BY COALESCE(model_tier, 'standard')`
    )
    .all();

  let agyFlashCount = 0;
  let agyProArgonCount = 0;
  for (const r of agyAllModelRows) {
    if (r.tier === "light") agyFlashCount += r.count;
    else agyProArgonCount += r.count;
  }
  const agyTotalAgents = agyFlashCount + agyProArgonCount;
  const flashRatioPct =
    agyTotalAgents > 0 ? Math.round((agyFlashCount / agyTotalAgents) * 100) : 60;
  const proArgonRatioPct = 100 - flashRatioPct;

  const agyEventCount5h =
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE provider IN ('antigravity', 'agy-claude', 'agy-gemini') AND created_at >= ?`
      )
      .get(fiveHoursAgo)?.count || 0;

  const agyTotalTokens5h =
    Number(agyAgentTokens.input_tokens || 0) + Number(agyAgentTokens.output_tokens || 0);
  const agyCap5h = 5000000; // 5M context bandwidth / flow quota
  const agyBurnTokensPerHour =
    Math.round(agyTotalTokens5h / 5) ||
    agyTiers.heavy * 72000 + agyTiers.standard * 36000 + agyTiers.light * 14000;
  const agyRequestsPerHour = Math.max(
    Math.round(agyEventCount5h / 5),
    (agyTiers.heavy + agyTiers.standard + agyTiers.light) * 18
  );

  const cascadeStatus = getCascadeStatus(db);

  return {
    timestamp: new Date().toISOString(),
    simulating: Boolean(activeSimulation && activeSimulation.running),
    claude: {
      provider: "claude",
      label: "Claude Code Subscription",
      window_5h_tokens: claudeTotal5h,
      window_5h_cap: claudeCap5h,
      window_5h_utilization_pct: Math.min(
        100,
        Math.round((claudeTotal5h / claudeCap5h) * 1000) / 10
      ),
      input_tokens: claudeInput,
      output_tokens: claudeOutput,
      cache_read_tokens: claudeCacheRead,
      cache_efficiency_pct: claudeCacheEfficiencyPct,
      active_subagents: claudeTiers,
      burn_rate_tokens_per_hr: claudeBurnPerHour,
      est_hours_to_cap: claudeHoursToCap,
    },
    antigravity: {
      provider: "antigravity",
      label: "Google Antigravity Subscription",
      session_tokens: agyTotalTokens5h,
      session_cap: agyCap5h,
      context_bandwidth_pct: Math.min(100, Math.round((agyTotalTokens5h / agyCap5h) * 1000) / 10),
      bytes_processed: Number(agyAgentTokens.bytes_processed || 0),
      flow_credits_used: Math.round(agyTotalTokens5h / 1000) + agyEventCount5h * 2,
      flow_credits_limit: 5000,
      active_subagents: agyTiers,
      model_distribution: {
        flash_pct: flashRatioPct,
        pro_argon_pct: proArgonRatioPct,
      },
      burn_rate_tokens_per_hr: agyBurnTokensPerHour,
      burn_rate_requests_per_hr: agyRequestsPerHour,
    },
    cascade: cascadeStatus,
  };
}

// GET /api/quota — Real-time dual subscription telemetry + 3-pool waterfall status
router.get("/quota", (_req, res) => {
  res.json(getDualQuotaTelemetry());
});

// POST /api/simulate/swarm — 25-second 3-Level agy-cascade Waterfall, Fan-Out & ===DIGEST=== Simulation
router.post("/swarm", (req, res) => {
  if (activeSimulation && activeSimulation.running) {
    for (const t of activeSimulation.timers) clearTimeout(t);
    activeSimulation.running = false;
  }

  clearSimulatedExhaustion();

  const simRunId = uuidv4().slice(0, 8);
  const claudeSessionId = `swarm-claude-${simRunId}`;
  const agySessionId = `swarm-agy-${simRunId}`;
  const cwd = req.body?.cwd || process.cwd();

  const claudeSonnetId = `${claudeSessionId}-sonnet-coder`;
  const claudeHaikuIds = [
    `${claudeSessionId}-haiku-explore-1`,
    `${claudeSessionId}-haiku-explore-2`,
    `${claudeSessionId}-haiku-explore-3`,
  ];
  // Level-2 Cross-CLI Bridge node under Level-1 Claude Conductor
  const bridgeAgentId = `${claudeSessionId}-bridge-agy-cascade`;
  // Level-3 Specialist Fan-Out Subagents under Level-2 agy-cascade Bridge
  const fanOutUnitIds = [
    `conv-${simRunId}-unit-1`,
    `conv-${simRunId}-unit-2`,
    `conv-${simRunId}-unit-3`,
  ];

  const agyFlowId = `${agySessionId}-flow-builder`;
  const agyFlashIds = [
    `${agySessionId}-flash-inspect-1`,
    `${agySessionId}-flash-inspect-2`,
    `${agySessionId}-flash-inspect-3`,
  ];

  const timers = [];
  const schedule = (delayMs, fn) => {
    const timer = setTimeout(() => {
      try {
        fn();
        broadcast("quota_updated", getDualQuotaTelemetry());
      } catch (err) {
        console.error("[SWARM-SIM] Step error:", err.message);
      }
    }, delayMs);
    timers.push(timer);
  };

  activeSimulation = {
    id: simRunId,
    running: true,
    claudeSessionId,
    agySessionId,
    timers,
  };

  // 0s–4s: Spawn Level-1 Claude Conductor (claude-direct, Opus 4.6) + Antigravity Orchestrator (Argon 4)
  // and run fast Read/Grep/Haiku exploration to design the 3-unit interface contract
  schedule(0, () => {
    hooksRouter.processEvent("SessionStart", {
      session_id: claudeSessionId,
      session_name: "Claude Conductor: 3-Pool agy-cascade Waterfall & Fan-Out",
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      cwd,
      prompt:
        "Design 3-unit interface contract and delegate bulk implementation via agy-cascade --yolo --digest with 3-subagent fan-out.",
      pid: 41012,
      metrics: { input_tokens: 14200, output_tokens: 1850, cache_read_tokens: 48000 },
    });
    hooksRouter.processEvent("UserPromptSubmit", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      cwd,
      prompt:
        "Design 3-unit interface contract and delegate bulk implementation via agy-cascade --yolo --digest with 3-subagent fan-out.",
      pid: 41012,
      metrics: { input_tokens: 18400, output_tokens: 2400, cache_read_tokens: 56000 },
    });

    hooksRouter.processEvent("SessionStart", {
      session_id: agySessionId,
      session_name: "Antigravity Swarm: Autonomous DAG & Subagent Verification",
      provider: "antigravity",
      model: "argon-4-ultra",
      effort: "high",
      cwd,
      prompt:
        "Architect real-time subagent hierarchy graph, verify cross-provider hooks, and benchmark 3.8-Flash parallel inspection.",
      pid: 52088,
      metrics: {
        input_tokens: 22000,
        output_tokens: 3100,
        cache_read_tokens: 64000,
        bytes_processed: 94200,
      },
    });
    hooksRouter.processEvent("UserPromptSubmit", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "argon-4-ultra",
      effort: "high",
      cwd,
      prompt:
        "Architect real-time subagent hierarchy graph, verify cross-provider hooks, and benchmark 3.8-Flash parallel inspection.",
      pid: 52088,
      metrics: {
        input_tokens: 26500,
        output_tokens: 3900,
        cache_read_tokens: 78000,
        bytes_processed: 128400,
      },
    });

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: `${claudeSessionId}-main`,
      provider: "claude",
      stream: "stdout",
      line: "[Level-1 Claude Conductor | Opus 4.6] Running Read/Grep to design 3-unit interface contract...",
      timestamp: new Date().toISOString(),
    });
  });

  // T+2000ms: Spawn native Haiku Explore subagents + Antigravity 3.8-Flash inspection subagents
  schedule(2000, () => {
    const haikuTasks = [
      {
        id: claudeHaikuIds[0],
        desc: "Explore: Scan SQLite schema & indexes",
        prompt: "Read server/db.js and map all session/agent foreign keys and indexes",
      },
      {
        id: claudeHaikuIds[1],
        desc: "Explore: Grep WebSocket broadcast hooks",
        prompt: "Grep broadcast calls across server/routes/hooks.js and server/websocket.js",
      },
      {
        id: claudeHaikuIds[2],
        desc: "Explore: Glob frontend telemetry components",
        prompt: "Glob client/src/components/**/*.tsx for agent cards and kanban views",
      },
    ];

    for (const h of haikuTasks) {
      hooksRouter.processEvent("PreToolUse", {
        session_id: claudeSessionId,
        provider: "claude",
        model: "claude-haiku-4-5",
        effort: "low",
        tool_name: "Task",
        tool_input: {
          id: h.id,
          description: h.desc,
          subagent_type: "Explore",
          subagent_role: "Explore",
          prompt: h.prompt,
          model: "claude-haiku-4-5",
          effort: "low",
        },
        pid: 41020 + haikuTasks.indexOf(h),
        metrics: {
          input_tokens: 8400,
          output_tokens: 920,
          cache_read_tokens: 24000,
        },
      });
    }

    hooksRouter.processEvent("PreToolUse", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "gemini-3.8-flash",
      effort: "low",
      tool_name: "invoke_subagent",
      tool_input: {
        Subagents: [
          {
            id: agyFlashIds[0],
            TypeName: "research",
            Role: "Explore: view_file_outline AST",
            Prompt: "Inspect AST symbols across server/controllers and server/utils",
            Model: "gemini-3.8-flash",
            Effort: "low",
          },
          {
            id: agyFlashIds[1],
            TypeName: "research",
            Role: "Explore: grep_search hook endpoints",
            Prompt: "Search all hook configurations in ~/.gemini/config/hooks.json",
            Model: "gemini-3.8-flash",
            Effort: "low",
          },
          {
            id: agyFlashIds[2],
            TypeName: "research",
            Role: "Explore: run_command diagnostics",
            Prompt: "Verify port 7770 telemetry throughput and WebSocket latency",
            Model: "gemini-3.8-flash",
            Effort: "low",
          },
        ],
      },
      pid: 52095,
      metrics: {
        input_tokens: 11200,
        output_tokens: 1450,
        cache_read_tokens: 39000,
        bytes_processed: 64000,
      },
    });
  });

  // 4s–10s: Level-1 Claude Conductor executes Bash -> `agy-cascade --dir . --yolo --digest --timeout 10m "..."`
  // Spawns Level-2 `agy-cascade` Bridge Agent initially on Pool 1: AGY-Claude (Opus 5.5 High, Electric Fuchsia)
  schedule(4000, () => {
    hooksRouter.processEvent("PreToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      tool_name: "Bash",
      tool_input: {
        command: `agy-cascade --dir "${cwd}" --model claude-opus-5-5-thinking --yolo --digest --timeout 10m "Execute 3-unit fan-out via define_subagent and invoke_subagent: Unit 1 Backend API, Unit 2 Thermal UI, Unit 3 Test Suite"`,
      },
      pid: 41040,
      metrics: {
        input_tokens: 24500,
        output_tokens: 3200,
        cache_read_tokens: 72000,
      },
    });

    // Also spawn Claude Sonnet 4.6 + Antigravity Standard Flow Agent for full thermal spectrum coverage
    hooksRouter.processEvent("PreToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      tool_name: "Agent",
      tool_input: {
        id: claudeSonnetId,
        description: "Code: Contract Validator",
        subagent_type: "Code",
        subagent_role: "Code",
        prompt:
          "Validate TypeScript & SQLite interface boundaries while agy-cascade executes bulk fan-out",
        model: "claude-sonnet-4-6",
        effort: "medium",
      },
      pid: 41055,
      metrics: {
        input_tokens: 29500,
        output_tokens: 4600,
        cache_read_tokens: 84000,
      },
    });

    hooksRouter.processEvent("PreToolUse", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "gemini-3-flow",
      effort: "medium",
      tool_name: "invoke_subagent",
      tool_input: {
        Subagents: [
          {
            id: agyFlowId,
            TypeName: "self",
            Role: "Code: Standard Flow Executor",
            Prompt: "Wire liveTranscriptWatcher.js and DualQuotaHeader telemetry counters",
            Model: "gemini-3-flow",
            Effort: "medium",
          },
        ],
      },
      pid: 52110,
      metrics: {
        input_tokens: 41000,
        output_tokens: 6400,
        cache_read_tokens: 115000,
        bytes_processed: 215000,
      },
    });

    const line1 =
      "[Level-2 agy-cascade | Pool 1: AGY-Claude Opus 5.5 Thinking] Starting cross-CLI bridge (--yolo --digest --timeout 10m)...";
    emitAgentStream(simRunId, claudeSessionId, bridgeAgentId, "agy-claude", line1);
    emitAgentStream(
      simRunId,
      claudeSessionId,
      bridgeAgentId,
      "agy-claude",
      "Reading spec: 3 units, disjoint write scopes, ===DIGEST=== required"
    );
    emitAgentStream(
      simRunId,
      claudeSessionId,
      claudeSonnetId,
      "claude",
      "tsc --noEmit on shared interfaces: 0 errors"
    );
  });

  // 5s-7s: Haiku scout #2 re-runs the same Grep four times in a row, tripping the
  // Attention Radar loop detector (same tool executed 4+ consecutive times).
  [5000, 5600, 6200, 6800].forEach((delay, idx) => {
    schedule(delay, () => {
      const loopAgent = stmts.getAgent.get(claudeHaikuIds[1]);
      if (!loopAgent || loopAgent.status !== "working") return;
      stmts.updateAgent.run(null, "working", null, "Grep", null, null, claudeHaikuIds[1]);
      broadcast("agent_updated", stmts.getAgent.get(claudeHaikuIds[1]));
      emitAgentEvent(
        claudeSessionId,
        claudeHaikuIds[1],
        "PreToolUse",
        "Grep",
        `Grep "broadcast\\(" server/ (attempt ${idx + 1}, 0 new matches)`
      );
    });
  });

  // T+7500ms: Simulate Exit Code 10 (Quota Exhausted) on Pool 1 (AGY-Claude Opus 5.5 Thinking) ->
  // Trigger `claude.exhausted` 30m cooldown banner -> Cascade Level-2 Bridge Agent to Pool 2: AGY-Gemini (Argon 4 Ultra)
  schedule(7500, () => {
    triggerSimulatedExhaustion("agy-claude", 1800, {
      reason: "Exit Code 10 (claude.exhausted — Pool 1 Opus 5.5 / Sonnet 5.5 quota exhausted)",
      cascadedTo: "agy-gemini",
      activeModel: "argon-4-ultra",
    });

    const bridgeAgent = stmts.getAgent.get(bridgeAgentId);
    if (bridgeAgent) {
      let meta = {};
      try {
        meta = JSON.parse(bridgeAgent.metadata || "{}");
      } catch {
        meta = {};
      }
      meta.pool_cascaded = true;
      meta.exhausted_pool = "agy-claude";
      meta.active_pool = "agy-gemini";
      meta.cascade_exit_code = 10;
      meta.exit_code_10_handled = true;

      stmts.updateAgent.run(
        "agy-cascade (Pool 2: Argon 4 Ultra)",
        "working",
        null,
        "define_subagent",
        null,
        JSON.stringify(meta),
        bridgeAgentId
      );
      stmts.updateAgentTelemetry.run(
        "antigravity",
        "Code",
        "argon-4-ultra",
        "heavy",
        "high",
        "tool_use",
        18400,
        3200,
        42000,
        0,
        14.8,
        76000,
        195000,
        JSON.stringify(meta),
        41042,
        bridgeAgentId
      );
      broadcast("agent_updated", stmts.getAgent.get(bridgeAgentId));
    }

    const line2 =
      "[agy-cascade] EXIT 10: Pool 1 (AGY-Claude Opus 5.5 Thinking) quota exhausted -> ~/.cache/agy-cascade/claude.exhausted locked (30:00 cooldown).";
    emitAgentStream(simRunId, claudeSessionId, bridgeAgentId, "antigravity", line2, "stderr");
    emitAgentStream(
      simRunId,
      claudeSessionId,
      bridgeAgentId,
      "antigravity",
      "[agy-cascade] Cascading to Pool 2: AGY-Gemini (Argon 4 Ultra, high effort)"
    );
  });

  // 10s–20s: Level-2 `agy-cascade` agent calls `define_subagent` and `invoke_subagent`,
  // fanning out 3 Level-3 Specialist Subagents (Unit 1: Backend API, Unit 2: Thermal UI, Unit 3: Test Suite)
  schedule(10000, () => {
    const units = [
      {
        id: fanOutUnitIds[0],
        name: "Unit 1: Backend API",
        role: "Code",
        task: "Implement cascadeCacheWatcher.js, /api/cascade/status, and 3-pool modelClassifier",
        tool: "replace_file_content",
      },
      {
        id: fanOutUnitIds[1],
        name: "Unit 2: Thermal UI",
        role: "Code",
        task: "Build 3-Pool Waterfall Status Bar, Fuchsia/Indigo AGY-Claude badges, and 3-level SubagentGraph",
        tool: "replace_file_content",
      },
      {
        id: fanOutUnitIds[2],
        name: "Unit 3: Test Suite",
        role: "Verifier",
        task: "Verify TypeScript compilation, client Vitest suite, and server node --test suite",
        tool: "run_command",
      },
    ];

    units.forEach((u, idx) => {
      const subMeta = {
        hierarchy_level: 3,
        conversation_id: u.id,
        role_title: u.name,
        fan_out_unit: idx + 1,
        parent_bridge_id: bridgeAgentId,
      };
      if (!stmts.getAgent.get(u.id)) {
        stmts.insertAgent.run(
          u.id,
          claudeSessionId,
          u.name,
          "subagent",
          "self",
          "working",
          u.task,
          bridgeAgentId,
          JSON.stringify(subMeta)
        );
        // insertAgent has no current_tool column; set it separately.
        stmts.updateAgent.run(null, null, null, u.tool, null, null, u.id);
      }
      stmts.updateAgentTelemetry.run(
        "antigravity",
        u.role,
        "gemini-3.8-flash-high",
        "light",
        "high",
        "tool_use",
        12400 + idx * 2800,
        2900 + idx * 600,
        31000,
        0,
        11.2 + idx * 2.5,
        64000,
        180000,
        JSON.stringify(subMeta),
        42100 + idx,
        u.id
      );
      broadcast("agent_created", stmts.getAgent.get(u.id));
    });

    const l3Msg = `[Level-2 agy-cascade -> Level-3 Fan-Out] Spawned 3 parallel specialist subagents (${fanOutUnitIds.join(", ")}) on Gemini 3.8 Flash High`;
    emitAgentStream(simRunId, claudeSessionId, bridgeAgentId, "antigravity", l3Msg);

    const unitLines = [
      [
        "replace_file_content server/watchers/cascadeCacheWatcher.js (+142 -8)",
        "run_command node --test server/__tests__/phase2-cascade.test.js: 9 pass",
      ],
      [
        "replace_file_content client/src/components/SubagentGraph.tsx (+96 -31)",
        "run_command npx tsc --noEmit: 0 errors",
      ],
      ["run_command npm --prefix client test -- --run", "Test Files 51 passed | Tests 499 passed"],
    ];
    fanOutUnitIds.forEach((uid, idx) => {
      for (const line of unitLines[idx]) {
        emitAgentStream(simRunId, claudeSessionId, uid, "antigravity", line);
      }
    });
  });

  // T+12500ms: the Level-1 Conductor hits a y/n permission prompt (Attention Radar: approval).
  schedule(12500, () => {
    hooksRouter.processEvent("Notification", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      notification_type: "permission_prompt",
      message: "Claude needs your permission to use Bash",
    });
    emitAgentStream(
      simRunId,
      claudeSessionId,
      `${claudeSessionId}-main`,
      "claude",
      'Permission required: Bash(git commit -m "checkpoint: pre-fanout") [y/n]'
    );
  });

  // T+17000ms: the operator approves; the Conductor resumes.
  schedule(17000, () => {
    const mainId = `${claudeSessionId}-main`;
    stmts.clearSessionAwaitingInput.run(claudeSessionId);
    stmts.clearAgentAwaitingInput.run(mainId);
    stmts.updateAgent.run(null, "working", null, "Bash", null, null, mainId);
    broadcast("session_updated", stmts.getSession.get(claudeSessionId));
    broadcast("agent_updated", stmts.getAgent.get(mainId));
    emitAgentStream(
      simRunId,
      claudeSessionId,
      mainId,
      "claude",
      "Approved (y). Checkpoint committed: [main 41b0c2e]"
    );
  });

  // T+15000ms: Level-3 Specialist Subagents create git checkpoints (`git commit -m "checkpoint: ..."`);
  // Haiku & 3.8-Flash exploration subagents finish
  schedule(15000, () => {
    for (const id of claudeHaikuIds) {
      hooksRouter.processEvent("SubagentStop", {
        session_id: claudeSessionId,
        agent_id: id,
        provider: "claude",
        model: "claude-haiku-4-5",
        effort: "low",
      });
    }
    for (const id of agyFlashIds) {
      hooksRouter.processEvent("SubagentStop", {
        session_id: agySessionId,
        agent_id: id,
        provider: "antigravity",
        model: "gemini-3.8-flash",
        effort: "low",
      });
    }

    const checkpointMsgs = [
      "checkpoint: unit-1 backend cascade watcher & 3-pool classifier complete",
      "checkpoint: unit-2 fuchsia/indigo thermal UI & 3-level DAG complete",
      "checkpoint: unit-3 client & server test suites verified",
    ];

    fanOutUnitIds.forEach((uid, idx) => {
      const unitAgent = stmts.getAgent.get(uid);
      if (unitAgent) {
        let meta = {};
        try {
          meta = JSON.parse(unitAgent.metadata || "{}");
        } catch {
          meta = {};
        }
        meta.git_checkpoints = 1;
        meta.git_commits = [checkpointMsgs[idx]];
        stmts.updateAgent.run(null, "working", null, "git commit", null, JSON.stringify(meta), uid);
        stmts.updateAgentTelemetry.run(
          "antigravity",
          unitAgent.subagent_role || "Code",
          "gemini-3.8-flash-high",
          "light",
          "high",
          "tool_use",
          24800 + idx * 3400,
          6200 + idx * 900,
          58000,
          0,
          21.4 + idx * 3.1,
          142000,
          240000,
          JSON.stringify(meta),
          42100 + idx,
          uid
        );
        broadcast("agent_updated", stmts.getAgent.get(uid));
      }
    });

    const commitShas = ["7c2e91a", "8d4f02b", "9e1a33c"];
    fanOutUnitIds.forEach((uid, idx) => {
      emitAgentStream(
        simRunId,
        claudeSessionId,
        uid,
        "antigravity",
        `git commit -m "${checkpointMsgs[idx]}" -> [main ${commitShas[idx]}]`
      );
    });
    const checkLine = `[OK] [Level-3 Checkpoints] All 3 fan-out units committed git checkpoints ([main 7c2e91a], [main 8d4f02b], [main 9e1a33c]).`;
    emitAgentStream(simRunId, claudeSessionId, bridgeAgentId, "antigravity", checkLine);
  });

  // 20s–25s: Level-3 subagents complete -> Level-2 `agy-cascade` compresses 45,200+ raw tokens into a
  // 10-line `===DIGEST===` block -> Level-1 Claude Conductor receives digest and runs `git diff` + `npm test`
  schedule(20000, () => {
    const nowTs = new Date().toISOString();
    fanOutUnitIds.forEach((uid) => {
      const unitAgent = stmts.getAgent.get(uid);
      if (unitAgent) {
        stmts.updateAgent.run(null, "completed", null, null, nowTs, unitAgent.metadata, uid);
        stmts.updateAgentTelemetry.run(
          null,
          null,
          null,
          null,
          null,
          "completed",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          unitAgent.metadata,
          null,
          uid
        );
        broadcast("agent_updated", stmts.getAgent.get(uid));
      }
    });

    hooksRouter.processEvent("SubagentStop", {
      session_id: claudeSessionId,
      agent_id: claudeSonnetId,
      provider: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
    });
    hooksRouter.processEvent("SubagentStop", {
      session_id: agySessionId,
      agent_id: agyFlowId,
      provider: "antigravity",
      model: "gemini-3-flow",
      effort: "medium",
    });

    const digestBlock = [
      "===DIGEST===",
      "1. Pool Waterfall: Pool 1 (AGY-Claude Opus 5.5 Thinking) hit Exit Code 10 -> auto-cascaded to Pool 2 (AGY-Gemini Argon 4 Ultra); 3 L3 units ran on Gemini 3.8 Flash High.",
      "2. Unit 1 (conv-unit-1): Built cascadeCacheWatcher.js, /api/cascade/status, and 3-pool modelClassifier [commit 7c2e91a].",
      "3. Unit 2 (conv-unit-2): Added Electric Fuchsia/Indigo AGY-Claude spectrum & 3-level SubagentGraph DAG [commit 8d4f02b].",
      "4. Unit 3 (conv-unit-3): Verified zero TypeScript errors and 100% unit test pass rate [commit 9e1a33c].",
      "5. Context Compression: 45,200 raw execution tokens compressed into 180-token digest (99.6% context reduction).",
      "===END_DIGEST===",
    ].join("\n");

    const digestTextOnly = digestBlock
      .replace("===DIGEST===", "")
      .replace("===END_DIGEST===", "")
      .trim();

    // The ===DIGEST=== is counted once, by the hooks router, when the Conductor's PostToolUse
    // below carries it (offloaded_tokens_saved pins the reported savings to 45,200).
    const bridgeAgent = stmts.getAgent.get(bridgeAgentId);
    if (bridgeAgent) {
      let meta = {};
      try {
        meta = JSON.parse(bridgeAgent.metadata || "{}");
      } catch {
        meta = {};
      }
      meta.digest = digestTextOnly;
      meta.digest_received = true;
      meta.offloaded_tokens_saved = 45200;
      meta.git_checkpoints = 3;
      meta.git_commits = [
        "checkpoint: unit-1 backend cascade watcher & 3-pool classifier complete",
        "checkpoint: unit-2 fuchsia/indigo thermal UI & 3-level DAG complete",
        "checkpoint: unit-3 client & server test suites verified",
      ];
      stmts.updateAgent.run(
        null,
        "completed",
        null,
        null,
        nowTs,
        JSON.stringify(meta),
        bridgeAgentId
      );
      stmts.updateAgentTelemetry.run(
        null,
        null,
        null,
        null,
        null,
        "completed",
        38400,
        7200,
        89000,
        0,
        24.6,
        198000,
        210000,
        JSON.stringify(meta),
        null,
        bridgeAgentId
      );
      broadcast("agent_updated", stmts.getAgent.get(bridgeAgentId));
    }

    // Level-1 Claude Conductor receives ===DIGEST=== and runs `git diff` + `npm test`
    hooksRouter.processEvent("PostToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      tool_name: "Bash",
      output: digestBlock,
      offloaded_tokens_saved: 45200,
      summary: "===DIGEST=== Received (45.2k tokens offloaded)",
    });

    hooksRouter.processEvent("PreToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      tool_name: "Bash",
      tool_input: { command: "git diff --stat HEAD~3 && npm test" },
      metrics: {
        input_tokens: 26400,
        output_tokens: 4100,
        cache_read_tokens: 94000,
      },
    });

    const digestNotice =
      "[===DIGEST=== Received] Offloaded 45,200 verbose tokens from the Claude Conductor. Running git diff --stat && npm test...";
    emitAgentStream(simRunId, claudeSessionId, `${claudeSessionId}-main`, "claude", digestNotice);
    emitAgentStream(
      simRunId,
      claudeSessionId,
      bridgeAgentId,
      "antigravity",
      "===DIGEST=== 45,200 raw tokens -> 180-token summary (99.6% context reduction)"
    );
  });

  // T+25000ms: Gracefully complete both swarm orchestrators
  schedule(25000, () => {
    hooksRouter.processEvent("PostToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      tool_name: "Bash",
    });
    hooksRouter.processEvent("Stop", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      metrics: {
        input_tokens: 29800,
        output_tokens: 4900,
        cache_read_tokens: 112000,
      },
    });

    hooksRouter.processEvent("PostToolUse", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "argon-4-ultra",
      effort: "high",
      tool_name: "run_command",
    });
    hooksRouter.processEvent("Stop", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "argon-4-ultra",
      effort: "high",
      metrics: {
        input_tokens: 134000,
        output_tokens: 28900,
        cache_read_tokens: 368000,
        bytes_processed: 640000,
      },
    });

    emitAgentStream(
      simRunId,
      claudeSessionId,
      `${claudeSessionId}-main`,
      "claude",
      "[DONE] [3-Level Waterfall Mission Complete] Claude Conductor + agy-cascade Bridge + 3x Fan-Out Subagents finished in 25.0s (45.2k tokens saved via ===DIGEST===)."
    );

    if (activeSimulation && activeSimulation.id === simRunId) {
      activeSimulation.running = false;
    }
    broadcast("swarm_simulation_completed", {
      simulation_id: simRunId,
      claude_session_id: claudeSessionId,
      antigravity_session_id: agySessionId,
    });
  });

  res.status(201).json({
    ok: true,
    simulation_id: simRunId,
    duration_ms: 25000,
    claude_session_id: claudeSessionId,
    antigravity_session_id: agySessionId,
    message:
      "25-second 3-Level agy-cascade Waterfall Simulation started (Level-1 Claude Conductor -> Level-2 agy-cascade Pool 1/Pool 2 Waterfall -> 3x Level-3 Fan-Out Subagents -> ===DIGEST===).",
  });
});

router.getDualQuotaTelemetry = getDualQuotaTelemetry;
module.exports = router;
