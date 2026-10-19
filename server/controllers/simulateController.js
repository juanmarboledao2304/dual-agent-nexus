/**
 * @file Dual-Subscription Quota Telemetry & One-Click 25-Second Swarm Simulator for Claude Code and Google Antigravity.
 * Powers the DualQuotaHeader and POST /api/simulate/swarm live WebSocket demonstration.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { db, stmts } = require("../db");
const { broadcast } = require("../websocket");
const hooksRouter = require("../routes/hooks");

const router = Router();

let activeSimulation = null;

/**
 * Compute real-time Dual Subscription Quota telemetry for Left Wing (Claude Code) and Right Wing (Google Antigravity).
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

  // Right Wing: Google Antigravity 5h rolling window + flow telemetry
  const agyAgentTokens = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(bytes_processed), 0) AS bytes_processed
       FROM agents
       WHERE provider = 'antigravity'
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
       WHERE provider = 'antigravity'
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
       WHERE provider = 'antigravity'
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
         WHERE provider = 'antigravity' AND created_at >= ?`
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
  };
}

// GET /api/quota — Real-time dual subscription telemetry
router.get("/quota", (_req, res) => {
  res.json(getDualQuotaTelemetry());
});

// POST /api/simulate/swarm — 25-second multi-step realistic Dual-Provider Swarm Simulation
router.post("/swarm", (req, res) => {
  if (activeSimulation && activeSimulation.running) {
    for (const t of activeSimulation.timers) clearTimeout(t);
    activeSimulation.running = false;
  }

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

  // T+0ms: Spawn both parent orchestrators:
  // 1) Claude Opus 4.6 (effort: high, Crimson Red)
  // 2) Antigravity Argon 4 (effort: high, Electric Purple)
  schedule(0, () => {
    hooksRouter.processEvent("SessionStart", {
      session_id: claudeSessionId,
      session_name: "Claude Swarm: Distributed Auth & Telemetry Refactor",
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      cwd,
      prompt:
        "Orchestrate multi-agent refactor of authentication middleware, SQLite telemetry schema, and React Mission Control UI.",
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
        "Orchestrate multi-agent refactor of authentication middleware, SQLite telemetry schema, and React Mission Control UI.",
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
      line: "[Opus 4.6 | effort=high] Initializing Claude Code Swarm Orchestrator — decomposing task into 4 subagents...",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: `${agySessionId}-main`,
      provider: "antigravity",
      stream: "stdout",
      line: "[Argon 4 Ultra | effort=high] Initializing Antigravity Architect — preparing parallel 3.8-Flash + Flow swarm...",
      timestamp: new Date().toISOString(),
    });
  });

  // T+2000ms: Spawn 3 Claude Haiku (effort: low, Amber Yellow) Explore subagents
  // and 3 Antigravity Gemini 3.8 Flash (effort: low, Emerald Green) fast inspection subagents
  schedule(2000, () => {
    const haikuTasks = [
      {
        id: claudeHaikuIds[0],
        desc: "Explore: Scan SQLite schema & indexes",
        prompt: "Read server/db.js and map all session/agent foreign keys and indexes",
        tool: "Read",
      },
      {
        id: claudeHaikuIds[1],
        desc: "Explore: Grep WebSocket broadcast hooks",
        prompt: "Grep broadcast calls across server/routes/hooks.js and server/websocket.js",
        tool: "Grep",
      },
      {
        id: claudeHaikuIds[2],
        desc: "Explore: Glob frontend telemetry components",
        prompt: "Glob client/src/components/**/*.tsx for agent cards and kanban views",
        tool: "Glob",
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
            Prompt: "Verify port 4820 telemetry throughput and WebSocket latency",
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

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: `${claudeSessionId}-main`,
      provider: "claude",
      stream: "stdout",
      line: "[Opus 4.6] Spawned 3x Haiku 4.5 (effort=low) Explore subagents -> Read, Grep, Glob",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: `${agySessionId}-main`,
      provider: "antigravity",
      stream: "stdout",
      line: "[Argon 4 Ultra] Spawned 3x Gemini 3.8 Flash (effort=low) subagents -> view_file_outline, grep_search, run_command",
      timestamp: new Date().toISOString(),
    });
  });

  // T+5000ms: Spawn 1 Claude Sonnet 4.6 (effort: medium, Vibrant Orange) Coder subagent
  // and 1 Antigravity Standard Flow Agent (effort: medium, Cyber Blue) subagent
  schedule(5000, () => {
    hooksRouter.processEvent("PreToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-sonnet-4-6",
      effort: "medium",
      tool_name: "Agent",
      tool_input: {
        id: claudeSonnetId,
        description: "Code: Implement Thermal UI & Dispatcher",
        subagent_type: "Code",
        subagent_role: "Code",
        prompt: "Build SubagentGraph SVG connectors and CommandCenterDock streaming console",
        model: "claude-sonnet-4-6",
        effort: "medium",
      },
      pid: 41055,
      metrics: {
        input_tokens: 34500,
        output_tokens: 5800,
        cache_read_tokens: 92000,
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

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: claudeSonnetId,
      provider: "claude",
      stream: "stdout",
      line: "[Sonnet 4.6 | effort=medium] Executing Code subagent: building Chromatic Thermal UI & SVG DAG...",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: agyFlowId,
      provider: "antigravity",
      stream: "stdout",
      line: "[Gemini 3 Flow | effort=medium] Executing Standard Flow Agent: streaming dual-subscription quota telemetry...",
      timestamp: new Date().toISOString(),
    });
  });

  // T+8500ms: Animate tool calls on the Haiku & 3.8-Flash subagents
  schedule(8500, () => {
    const claudeTools = ["Read", "Grep", "Glob"];
    claudeHaikuIds.forEach((id, idx) => {
      const a = stmts.getAgent.get(id);
      if (a) {
        stmts.updateAgent.run(null, "working", null, claudeTools[idx], null, null, id);
        stmts.updateAgentTelemetry.run(
          "claude",
          "Explore",
          "claude-haiku-4-5",
          "light",
          "low",
          "tool_use",
          14200 + idx * 3100,
          2100 + idx * 450,
          38000,
          1200,
          28.4 + idx * 4.2,
          42000,
          145000,
          null,
          41020 + idx,
          id
        );
        broadcast("agent_updated", stmts.getAgent.get(id));
      }
    });

    const agyTools = ["view_file_outline", "grep_search", "run_command"];
    agyFlashIds.forEach((id, idx) => {
      const a = stmts.getAgent.get(id);
      if (a) {
        stmts.updateAgent.run(null, "working", null, agyTools[idx], null, null, id);
        stmts.updateAgentTelemetry.run(
          "antigravity",
          "Explore",
          "gemini-3.8-flash",
          "light",
          "low",
          "tool_use",
          16800 + idx * 2900,
          2600 + idx * 520,
          49000,
          1500,
          19.6 + idx * 3.8,
          88000,
          168000,
          null,
          52095 + idx,
          id
        );
        broadcast("agent_updated", stmts.getAgent.get(id));
      }
    });

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: claudeHaikuIds[0],
      provider: "claude",
      stream: "stdout",
      line: "[Haiku 4.5 #1] Read(server/db.js) -> 2,540 lines indexed (cache hit: 81%)",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: agyFlashIds[0],
      provider: "antigravity",
      stream: "stdout",
      line: "[3.8 Flash #1] view_file_outline(server/utils/modelClassifier.js) -> 8 exports verified in 140ms",
      timestamp: new Date().toISOString(),
    });
  });

  // T+13000ms: Complete the 3 Haiku Explore subagents and 3 Gemini 3.8 Flash subagents;
  // ramp up Sonnet 4.6 and Standard Flow Agent tool usage
  schedule(13000, () => {
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

    // Update Sonnet and Flow agents to active tool use
    if (stmts.getAgent.get(claudeSonnetId)) {
      stmts.updateAgent.run(null, "working", null, "Edit", null, null, claudeSonnetId);
      stmts.updateAgentTelemetry.run(
        "claude",
        "Code",
        "claude-sonnet-4-6",
        "standard",
        "medium",
        "tool_use",
        68400,
        14200,
        142000,
        8400,
        62.5,
        184000,
        310000,
        null,
        41055,
        claudeSonnetId
      );
      broadcast("agent_updated", stmts.getAgent.get(claudeSonnetId));
    }

    if (stmts.getAgent.get(agyFlowId)) {
      stmts.updateAgent.run(null, "working", null, "replace_file_content", null, null, agyFlowId);
      stmts.updateAgentTelemetry.run(
        "antigravity",
        "Code",
        "gemini-3-flow",
        "standard",
        "medium",
        "tool_use",
        74200,
        16800,
        165000,
        9200,
        48.2,
        312000,
        340000,
        null,
        52110,
        agyFlowId
      );
      broadcast("agent_updated", stmts.getAgent.get(agyFlowId));
    }

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: claudeSonnetId,
      provider: "claude",
      stream: "stdout",
      line: "[Sonnet 4.6] All 3 Haiku Explore subagents returned context. Applying Edit(SubagentGraph.tsx)...",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: agyFlowId,
      provider: "antigravity",
      stream: "stdout",
      line: "[Gemini 3 Flow] All 3 Flash subagents converged. Updating replace_file_content(DualQuotaHeader.tsx)...",
      timestamp: new Date().toISOString(),
    });
  });

  // T+19000ms: Sonnet 4.6 and Standard Flow Agent complete; Opus 4.6 and Argon 4 Ultra run final verification
  schedule(19000, () => {
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

    hooksRouter.processEvent("PreToolUse", {
      session_id: claudeSessionId,
      provider: "claude",
      model: "claude-opus-4-6",
      effort: "high",
      tool_name: "Bash",
      tool_input: { command: "npm run verify" },
      metrics: {
        input_tokens: 96000,
        output_tokens: 19400,
        cache_read_tokens: 248000,
      },
    });

    hooksRouter.processEvent("PreToolUse", {
      session_id: agySessionId,
      provider: "antigravity",
      model: "argon-4-ultra",
      effort: "high",
      tool_name: "run_command",
      tool_input: { CommandLine: "npm run build" },
      metrics: {
        input_tokens: 112000,
        output_tokens: 23800,
        cache_read_tokens: 295000,
        bytes_processed: 520000,
      },
    });

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: `${claudeSessionId}-main`,
      provider: "claude",
      stream: "stdout",
      line: "[Opus 4.6 | effort=high] Running final verification gate: npm run verify...",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: `${agySessionId}-main`,
      provider: "antigravity",
      stream: "stdout",
      line: "[Argon 4 Ultra | effort=high] Verifying production bundle & dual-subscription telemetry parity...",
      timestamp: new Date().toISOString(),
    });
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
        input_tokens: 118000,
        output_tokens: 24600,
        cache_read_tokens: 312000,
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

    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: claudeSessionId,
      agent_id: `${claudeSessionId}-main`,
      provider: "claude",
      stream: "stdout",
      line: "✓ [Claude Swarm Complete] Opus 4.6 + 1x Sonnet 4.6 + 3x Haiku 4.5 finished in 25.0s.",
      timestamp: new Date().toISOString(),
    });
    broadcast("dispatch_stream", {
      dispatch_id: simRunId,
      session_id: agySessionId,
      agent_id: `${agySessionId}-main`,
      provider: "antigravity",
      stream: "stdout",
      line: "✓ [Antigravity Swarm Complete] Argon 4 Ultra + 1x Flow + 3x 3.8-Flash finished in 25.0s.",
      timestamp: new Date().toISOString(),
    });

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
      "25-second Dual-Provider Swarm Simulation started (Opus + Sonnet + 3x Haiku | Argon + Flow + 3x 3.8-Flash).",
  });
});

router.getDualQuotaTelemetry = getDualQuotaTelemetry;
module.exports = router;
