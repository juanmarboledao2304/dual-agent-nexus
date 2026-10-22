/**
 * @file Unified Prompt Dispatcher & Process Manager for Claude Code CLI, Google Antigravity CLI (agy), and Dual Swarm mode.
 * Spawns child processes, streams stdout/stderr over WebSockets, records telemetry in SQLite, and provides a SIGTERM kill switch.
 * Dispatches are one-shot: when the process exits the session is closed (completed or error), never left
 * "waiting" for input it cannot receive. A missing CLI fails the dispatch visibly; the canned telemetry
 * stream only runs when NEXUS_DISPATCH_SIMULATE=1 (demos).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const { Router } = require("express");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");
const hooksRouter = require("../routes/hooks");
const { classifyModelAndEffort } = require("../utils/modelClassifier");
const { resolveCommand } = require("../lib/command-resolver");

const router = Router();

/** Lines of process output kept for the final Stop event (digest + git checkpoint detection). */
const OUTPUT_TAIL_LINES = 200;

/** True when the canned telemetry stream may stand in for a missing CLI (demo setups only). */
function simulationAllowed() {
  return /^(1|true|yes|on)$/i.test(String(process.env.NEXUS_DISPATCH_SIMULATE || "").trim());
}

/** Last lines of output quoted in a non-zero exit reason, so the stored error says why it failed. */
const FAILURE_TAIL_LINES = 3;

/**
 * Reason for a non-zero exit: the code plus the last plain-text lines the CLI printed
 * (machine lines such as AGY_USAGE / AGY_SIGNAL JSON are skipped), e.g. agy-cascade's
 * "todos los modelos de Antigravity están sin cuota".
 */
function exitFailureReason(bin, code, outputTail) {
  const base = `CLI '${bin}' exited with code ${code}`;
  const lastLines = (outputTail || [])
    .map((line) => String(line).trim())
    .filter((line) => line && !/^AGY_[A-Z_]+\s*[{:]/.test(line))
    .slice(-FAILURE_TAIL_LINES);
  return lastLines.length ? `${base}: ${lastLines.join(" | ")}` : base;
}

/**
 * Fail a dispatch that could not run: log why, land the session in `error`, and tell the UI.
 */
function failDispatch(dispatchEntry, reason) {
  if (dispatchEntry.status === "killed" || dispatchEntry.status === "error") return;
  emitDispatchStream(dispatchEntry, "stderr", `[dispatch] ${reason}`);
  dispatchEntry.status = "error";
  hooksRouter.processEvent("Stop", {
    session_id: dispatchEntry.sessionId,
    provider: dispatchEntry.provider,
    model: dispatchEntry.model,
    effort: dispatchEntry.effort,
    stop_reason: "error",
    output: reason,
  });
  broadcast("dispatch_status", {
    dispatch_id: dispatchEntry.id,
    dispatchId: dispatchEntry.id,
    session_id: dispatchEntry.sessionId,
    sessionId: dispatchEntry.sessionId,
    agent_id: dispatchEntry.agentId,
    agentId: dispatchEntry.agentId,
    provider: dispatchEntry.provider,
    status: "error",
    error: reason,
  });
}

// Active dispatched processes: Map<dispatchId, { id, sessionId, agentId, provider, model, effort, cwd, pid, child, timer, startedAt, status, logs }>
const activeDispatches = new Map();

/**
 * Emit a line of stdout/stderr to both WebSocket subscribers and the in-memory log buffer.
 */
function emitDispatchStream(dispatchEntry, stream, line) {
  if (!line) return;
  const text = String(line);
  const entry = {
    dispatch_id: dispatchEntry.id,
    dispatchId: dispatchEntry.id,
    session_id: dispatchEntry.sessionId,
    sessionId: dispatchEntry.sessionId,
    agent_id: dispatchEntry.agentId,
    agentId: dispatchEntry.agentId,
    provider: dispatchEntry.provider,
    stream,
    line: text,
    chunk: text.endsWith("\n") ? text : `${text}\n`,
    timestamp: new Date().toISOString(),
  };
  dispatchEntry.logs.push(entry);
  if (dispatchEntry.logs.length > 250) {
    dispatchEntry.logs.shift();
  }
  broadcast("dispatch_stream", entry);
}

function buildFanOutPrompt(userPrompt, cwd) {
  return [
    `Execute 3-Unit Internal Fan-Out in ${cwd} for task: "${userPrompt}"`,
    `1. Call define_subagent for 3 disjoint specialist units (Unit-1 Backend/Core, Unit-2 Frontend/UI, Unit-3 Tests/Verification).`,
    `2. Call invoke_subagent concurrently with 3 entries so each runs in its own conversationId.`,
    `3. Each subagent must create a git checkpoint: git commit -m "checkpoint: <unit> complete".`,
    `4. Compress the final result into a <=10-line ===DIGEST=== block.`,
  ].join("\n");
}

/**
 * Fallback live telemetry stream when the target CLI binary (claude, agy, or agy-cascade) is not installed on PATH.
 * Ensures the Command Center Dock and Agent Cards work out-of-the-box on any machine.
 */
function runSimulatedCliFallback(dispatchEntry, prompt) {
  const { sessionId, agentId, provider, model, effort, cwd, mode } = dispatchEntry;
  const isCascade = mode === "cascade" || mode === "fanout" || provider === "agy-claude";
  const isFanOut = mode === "fanout";
  const isAgy = provider === "antigravity" || isCascade;

  const digestOutput = [
    "===DIGEST===",
    `- Task Completed: ${prompt.slice(0, 72)}`,
    `- Pool Waterfall: Pool 1 (AGY-Claude Opus 5.5 High) -> Pool 2 (AGY-Gemini 3.8 Flash High)`,
    `- Fan-Out Units: ${isFanOut ? "3 specialist subagents (Unit 1, Unit 2, Unit 3)" : "Direct waterfall execution"}`,
    `- Git Checkpoints: ${isFanOut ? "3 commits verified cleanly" : "1 checkpoint commit verified"}`,
    `- Offloaded Verbose Trace: ~${isFanOut ? "38,400" : "19,200"} raw tokens compressed into 6-line digest`,
    "===END_DIGEST===",
  ].join("\n");

  const steps = isFanOut
    ? [
        {
          delay: 300,
          tool: "Bash",
          msg: `[claude-conductor] Delegating to agy-cascade --dir "${cwd}" --yolo --digest --timeout 10m`,
          inTok: 1650,
          outTok: 340,
          toolInput: {
            command: `agy-cascade --dir "${cwd}" --yolo --digest --timeout 10m "${prompt.slice(0, 90)}"`,
          },
        },
        {
          delay: 1300,
          tool: "invoke_subagent",
          msg: `[agy-cascade:Opus 5.5 High] Calling invoke_subagent to fan out 3 parallel specialist units...`,
          inTok: 4800,
          outTok: 1120,
          subagents: [
            {
              conversationId: `${sessionId}-conv-unit-1`,
              TypeName: "self",
              Role: "Code",
              Prompt: `Unit 1 (Backend & Schema): ${prompt.slice(0, 64)}`,
              Model: "flash",
            },
            {
              conversationId: `${sessionId}-conv-unit-2`,
              TypeName: "self",
              Role: "Code",
              Prompt: `Unit 2 (Thermal UI & Waterfall): ${prompt.slice(0, 64)}`,
              Model: "flash",
            },
            {
              conversationId: `${sessionId}-conv-unit-3`,
              TypeName: "research",
              Role: "Verifier",
              Prompt: `Unit 3 (Verification & Tests): ${prompt.slice(0, 64)}`,
              Model: "flash",
            },
          ],
        },
        {
          delay: 2800,
          tool: "Bash",
          msg: `[agy-cascade] Subagents committed git checkpoints: [main 9a4c1e2] checkpoint: fan-out units verified`,
          inTok: 9400,
          outTok: 2480,
          toolInput: {
            command: `git commit -m "checkpoint: fan-out units 1-3 complete"`,
          },
          output: `[main 9a4c1e2] checkpoint: fan-out units 1-3 complete`,
        },
        {
          delay: 4400,
          tool: null,
          msg: `[agy-cascade] Returning compressed ===DIGEST=== block to Claude Conductor (38.4k tokens saved).`,
          inTok: 12600,
          outTok: 3100,
          output: digestOutput,
          done: true,
        },
      ]
    : isCascade
      ? [
          {
            delay: 350,
            tool: "Bash",
            msg: `[agy-cascade:${model}] Starting Pool 1 (AGY-Claude Opus 5.5 High) waterfall in ${cwd} (--yolo)`,
            inTok: 1950,
            outTok: 390,
            toolInput: {
              command: `agy-cascade --dir "${cwd}" --yolo --digest "${prompt.slice(0, 90)}"`,
            },
          },
          {
            delay: 1600,
            tool: "replace_file_content",
            msg: `[agy-cascade:${model}] Applying autonomous edits and creating git checkpoint...`,
            inTok: 5800,
            outTok: 1450,
          },
          {
            delay: 3000,
            tool: "Bash",
            msg: `[agy-cascade:${model}] Created git checkpoint: [main 4f8b2d1] checkpoint: agy-cascade task complete`,
            inTok: 8900,
            outTok: 2180,
            toolInput: {
              command: `git commit -m "checkpoint: agy-cascade task complete"`,
            },
            output: `[main 4f8b2d1] checkpoint: agy-cascade task complete`,
          },
          {
            delay: 4400,
            tool: null,
            msg: `[agy-cascade:${model}] Emitting ===DIGEST=== summary (19.2k raw tokens offloaded).`,
            inTok: 11400,
            outTok: 2950,
            output: digestOutput,
            done: true,
          },
        ]
      : isAgy
        ? [
            {
              delay: 350,
              tool: "view_file",
              msg: `[agy:${model}] Analyzing workspace ${cwd} (effort=${effort})`,
              inTok: 1850,
              outTok: 320,
            },
            {
              delay: 1400,
              tool: "invoke_subagent",
              msg: `[agy:${model}] Spawning 3.8-Flash fast exploration subagent for "${prompt.slice(0, 48)}"`,
              inTok: 4200,
              outTok: 890,
              subagent: {
                TypeName: "research",
                Role: "Explore",
                Prompt: `Fast context scan for: ${prompt.slice(0, 80)}`,
                Model: "gemini-3.8-flash",
                Effort: "low",
              },
            },
            {
              delay: 2900,
              tool: "replace_file_content",
              msg: `[agy:${model}] Synthesizing solution & verifying AST invariants...`,
              inTok: 8400,
              outTok: 2150,
            },
            {
              delay: 4500,
              tool: null,
              msg: `[agy:${model}] Execution complete. All verification checks passed.`,
              inTok: 11200,
              outTok: 3400,
              done: true,
            },
          ]
        : [
            {
              delay: 350,
              tool: "Read",
              msg: `[claude:${model}] Inspecting repository in ${cwd} (CLAUDE_CODE_EFFORT=${effort})`,
              inTok: 2100,
              outTok: 410,
            },
            {
              delay: 1500,
              tool: "Task",
              msg: `[claude:${model}] Dispatching Haiku 4.5 Explore subagent for "${prompt.slice(0, 48)}"`,
              inTok: 5600,
              outTok: 1120,
              subagent: {
                description: "Explore codebase structure",
                subagent_type: "Explore",
                prompt: `Explore files related to: ${prompt.slice(0, 80)}`,
                model: "claude-haiku-4-5",
                effort: "low",
              },
            },
            {
              delay: 3100,
              tool: "Edit",
              msg: `[claude:${model}] Applying changes and running verification suite...`,
              inTok: 9800,
              outTok: 2650,
            },
            {
              delay: 4700,
              tool: null,
              msg: `[claude:${model}] Task completed cleanly.`,
              inTok: 13400,
              outTok: 3900,
              done: true,
            },
          ];

  const timers = [];
  for (const step of steps) {
    const t = setTimeout(() => {
      if (dispatchEntry.status === "killed") return;
      emitDispatchStream(dispatchEntry, "stdout", step.msg);

      if (step.subagents) {
        hooksRouter.processEvent("PreToolUse", {
          session_id: sessionId,
          provider,
          model,
          effort,
          cwd,
          tool_name: step.tool,
          tool_input: { Subagents: step.subagents },
          metrics: {
            input_tokens: step.inTok,
            output_tokens: step.outTok,
            cache_read_tokens: Math.round(step.inTok * 0.65),
          },
        });
      } else if (step.subagent) {
        hooksRouter.processEvent("PreToolUse", {
          session_id: sessionId,
          provider,
          model,
          effort,
          cwd,
          tool_name: step.tool,
          tool_input: isAgy ? { Subagents: [step.subagent] } : step.subagent,
          metrics: {
            input_tokens: step.inTok,
            output_tokens: step.outTok,
            cache_read_tokens: Math.round(step.inTok * 0.65),
          },
        });
      } else if (step.tool) {
        hooksRouter.processEvent("PreToolUse", {
          session_id: sessionId,
          provider,
          model,
          effort,
          cwd,
          tool_name: step.tool,
          tool_input: step.toolInput || { prompt: prompt.slice(0, 120) },
          output: step.output || undefined,
          metrics: {
            input_tokens: step.inTok,
            output_tokens: step.outTok,
            cache_read_tokens: Math.round(step.inTok * 0.6),
          },
        });
      } else if (step.done) {
        hooksRouter.processEvent("PostToolUse", {
          session_id: sessionId,
          provider,
          model,
          effort,
          tool_name: "Bash",
          tool_input: {
            command: `agy-cascade --dir "${cwd}" --yolo --digest "${prompt.slice(0, 80)}"`,
          },
          output: step.output || undefined,
        });
        hooksRouter.processEvent("SubagentStop", {
          session_id: sessionId,
          provider,
          model,
          effort,
        });
        hooksRouter.processEvent("Stop", {
          session_id: sessionId,
          provider,
          model,
          effort,
          output: step.output || undefined,
          metrics: {
            input_tokens: step.inTok,
            output_tokens: step.outTok,
            cache_read_tokens: Math.round(step.inTok * 0.72),
          },
        });
        hooksRouter.processEvent("SessionEnd", { session_id: sessionId, provider, model, effort });
        dispatchEntry.status = "completed";
        broadcast("dispatch_status", {
          dispatch_id: dispatchEntry.id,
          dispatchId: dispatchEntry.id,
          session_id: sessionId,
          sessionId,
          agent_id: agentId,
          agentId,
          provider,
          status: "completed",
        });
      }
    }, step.delay);
    timers.push(t);
  }
  dispatchEntry.timers = timers;
}

/**
 * Spawn a single provider agent process (`claude`, `antigravity`, `cascade`, or `fanout`).
 */
function spawnSingleProvider({ provider, prompt, model, effort, cwd, mode = "single" }) {
  const resolvedCwd = cwd && String(cwd).trim() ? String(cwd).trim() : process.cwd();
  const classified = classifyModelAndEffort({
    provider,
    model,
    effort,
    source: mode === "cascade" || mode === "fanout" ? "agy-cascade" : "",
    subagentRole: "Main",
    isSubagent: false,
    type: "main",
  });

  const dispatchId = uuidv4();
  const sessionId = `dispatch-${classified.provider}-${dispatchId.slice(0, 8)}`;
  const agentId = `${sessionId}-main`;
  const fakePid = Math.floor(20000 + Math.random() * 60000);

  const sessionPrefix =
    mode === "fanout"
      ? "AGY Fan-Out Swarm"
      : mode === "cascade"
        ? "agy-cascade"
        : classified.provider === "antigravity"
          ? "Antigravity"
          : classified.provider === "agy-claude"
            ? "AGY-Claude"
            : "Claude";

  // Create initial session & main agent via processEvent
  hooksRouter.processEvent("SessionStart", {
    session_id: sessionId,
    session_name: `${sessionPrefix}: ${prompt.slice(0, 42)}`,
    provider: classified.provider,
    model: classified.model,
    effort: classified.effort,
    cwd: resolvedCwd,
    prompt,
    pid: fakePid,
  });

  hooksRouter.processEvent("UserPromptSubmit", {
    session_id: sessionId,
    provider: classified.provider,
    model: classified.model,
    effort: classified.effort,
    cwd: resolvedCwd,
    prompt,
    pid: fakePid,
  });

  const dispatchEntry = {
    id: dispatchId,
    sessionId,
    agentId,
    provider: classified.provider,
    model: classified.model,
    model_tier: classified.model_tier,
    effort: classified.effort,
    mode,
    cwd: resolvedCwd,
    pid: fakePid,
    child: null,
    timers: [],
    startedAt: new Date().toISOString(),
    status: "running",
    logs: [],
  };

  activeDispatches.set(dispatchId, dispatchEntry);

  const isCascadeCli = mode === "cascade" || mode === "fanout";
  const isAgy = classified.provider === "antigravity";
  const bin = isCascadeCli ? "agy-cascade" : isAgy ? "agy" : "claude";
  const effectivePrompt = mode === "fanout" ? buildFanOutPrompt(prompt, resolvedCwd) : prompt;
  const args = isCascadeCli
    ? mode === "fanout"
      ? ["--dir", resolvedCwd, "--yolo", "--digest", "--timeout", "10m", effectivePrompt]
      : ["--dir", resolvedCwd, "--yolo", effectivePrompt]
    : isAgy
      ? ["-p", prompt, "--model", classified.model]
      : ["-p", prompt, "--model", classified.model, "--output-format", "stream-json", "--verbose"];

  const env = {
    ...process.env,
    CLAUDE_CODE_EFFORT: classified.effort,
    ANTIGRAVITY_EFFORT: classified.effort,
  };

  const launch = resolveCommand(bin, args, { env });
  if (!launch) {
    const reason =
      `CLI '${bin}' could not be launched: not found on PATH` +
      (process.platform === "win32" ? " (or it is a bash script and Git Bash was not found)" : "");
    if (simulationAllowed()) {
      emitDispatchStream(dispatchEntry, "stdout", `[telemetry-bridge] ${reason} — simulating`);
      runSimulatedCliFallback(dispatchEntry, prompt);
    } else {
      failDispatch(dispatchEntry, reason);
    }
    return dispatchResult(dispatchEntry, classified);
  }

  try {
    const child = spawn(launch.command, launch.args, {
      cwd: resolvedCwd,
      env,
      shell: launch.shell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    dispatchEntry.child = child;
    if (child.pid) {
      dispatchEntry.pid = child.pid;
      stmts.updateSessionTelemetry.run(null, null, null, null, null, child.pid, sessionId);
      stmts.updateAgentTelemetry.run(
        null,
        null,
        null,
        null,
        null,
        "thinking",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        child.pid,
        agentId
      );
    }

    emitDispatchStream(
      dispatchEntry,
      "stdout",
      `[spawn] ${launch.via === "direct" ? bin : `${bin} (via ${launch.via})`} ${args
        .map((a) => (a.includes(" ") ? `"${a}"` : a))
        .join(" ")} (PID ${dispatchEntry.pid})`
    );

    // Last lines of real output, handed to the final Stop event so ===DIGEST=== blocks and git
    // checkpoints the CLI printed are recorded on the agent.
    const outputTail = [];
    const rememberOutput = (line) => {
      outputTail.push(line);
      if (outputTail.length > OUTPUT_TAIL_LINES) outputTail.shift();
    };

    let launchFailed = false;
    const handleLaunchFailure = (reason) => {
      if (launchFailed || dispatchEntry.status === "killed") return;
      launchFailed = true;
      if (simulationAllowed()) {
        emitDispatchStream(dispatchEntry, "stdout", `[telemetry-bridge] ${reason} — simulating`);
        runSimulatedCliFallback(dispatchEntry, prompt);
      } else {
        failDispatch(dispatchEntry, reason);
      }
    };

    let stdoutBuf = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdoutBuf += chunk.toString("utf8");
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            rememberOutput(line);
            emitDispatchStream(dispatchEntry, "stdout", line);
          }
        }
      });
    }

    let stderrBuf = "";
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString("utf8");
        const lines = stderrBuf.split(/\r?\n/);
        stderrBuf = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            rememberOutput(line);
            emitDispatchStream(dispatchEntry, "stderr", line);
          }
        }
      });
    }

    child.on("error", (err) => {
      handleLaunchFailure(`CLI '${bin}' failed to start (${err.code || err.message})`);
    });

    child.on("close", (code) => {
      if (launchFailed || dispatchEntry.status === "killed") return;
      for (const rest of [stdoutBuf, stderrBuf]) {
        if (rest.trim()) {
          rememberOutput(rest);
          emitDispatchStream(dispatchEntry, "stdout", rest);
        }
      }
      if (code !== 0) {
        failDispatch(dispatchEntry, exitFailureReason(bin, code, outputTail));
        return;
      }
      dispatchEntry.status = "completed";
      hooksRouter.processEvent("Stop", {
        session_id: sessionId,
        provider: classified.provider,
        model: classified.model,
        effort: classified.effort,
        stop_reason: "end_turn",
        output: outputTail.join("\n"),
      });
      // A dispatch is one-shot: its process is gone, so nothing can answer a "waiting" prompt.
      hooksRouter.processEvent("SessionEnd", {
        session_id: sessionId,
        provider: classified.provider,
        model: classified.model,
        effort: classified.effort,
      });
      broadcast("dispatch_status", {
        dispatch_id: dispatchId,
        dispatchId,
        session_id: sessionId,
        sessionId,
        agent_id: agentId,
        agentId,
        provider: classified.provider,
        status: dispatchEntry.status,
        exit_code: code,
      });
    });
  } catch (err) {
    if (simulationAllowed()) {
      emitDispatchStream(dispatchEntry, "stdout", `[telemetry-bridge] ${err.message} — simulating`);
      runSimulatedCliFallback(dispatchEntry, prompt);
    } else {
      failDispatch(dispatchEntry, `CLI '${bin}' failed to start (${err.message})`);
    }
  }

  return dispatchResult(dispatchEntry, classified);
}

/** Response shape for one dispatch (shared by the success and early-failure paths). */
function dispatchResult(dispatchEntry, classified) {
  return {
    dispatch_id: dispatchEntry.id,
    dispatchId: dispatchEntry.id,
    session_id: dispatchEntry.sessionId,
    sessionId: dispatchEntry.sessionId,
    agent_id: dispatchEntry.agentId,
    agentId: dispatchEntry.agentId,
    provider: classified.provider,
    model: classified.model,
    model_tier: classified.model_tier,
    modelTier: classified.model_tier,
    effort: classified.effort,
    mode: dispatchEntry.mode,
    cwd: dispatchEntry.cwd,
    pid: dispatchEntry.pid,
    status: dispatchEntry.status,
  };
}

/**
 * Kill a running dispatch or agent by dispatch_id, session_id, or agent_id.
 */
function killAgentOrDispatch(targetId) {
  let killedProc = false;
  for (const entry of activeDispatches.values()) {
    if (
      entry.id === targetId ||
      entry.sessionId === targetId ||
      entry.agentId === targetId ||
      String(entry.pid) === String(targetId)
    ) {
      entry.status = "killed";
      if (Array.isArray(entry.timers)) {
        for (const t of entry.timers) clearTimeout(t);
      }
      if (entry.child && !entry.child.killed) {
        try {
          entry.child.kill("SIGTERM");
          killedProc = true;
        } catch {
          // ignore
        }
      }
      emitDispatchStream(
        entry,
        "stderr",
        `[SIGTERM] Process ${entry.pid} terminated via Mission Control Kill Switch.`
      );
      broadcast("dispatch_status", {
        dispatch_id: entry.id,
        dispatchId: entry.id,
        session_id: entry.sessionId,
        sessionId: entry.sessionId,
        agent_id: entry.agentId,
        agentId: entry.agentId,
        provider: entry.provider,
        status: "killed",
      });
    }
  }

  // Also mark matching agent or session in SQLite as error/terminated
  const agent = stmts.getAgent.get(targetId);
  const now = new Date().toISOString();
  if (agent) {
    if (agent.pid && !killedProc) {
      try {
        process.kill(Number(agent.pid), "SIGTERM");
        killedProc = true;
      } catch {
        // process may not be an OS process or already exited
      }
    }
    stmts.updateAgent.run(null, "error", null, null, now, agent.metadata, agent.id);
    stmts.updateAgentTelemetry.run(
      null,
      null,
      null,
      null,
      null,
      "error",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      agent.id
    );
    const updatedAgent = stmts.getAgent.get(agent.id);
    if (updatedAgent) broadcast("agent_updated", updatedAgent);

    stmts.insertTelemetryEvent.run(
      agent.session_id,
      agent.id,
      "AgentKilled",
      "SIGTERM",
      `Terminated ${agent.name} (PID ${agent.pid || "N/A"}) via Kill Switch`,
      JSON.stringify({ agent_id: agent.id, pid: agent.pid, signal: "SIGTERM" }),
      agent.provider || "claude",
      agent.model || null,
      agent.model_tier || "standard",
      agent.effort || "medium",
      null
    );
    broadcast("new_event", {
      session_id: agent.session_id,
      agent_id: agent.id,
      event_type: "AgentKilled",
      tool_name: "SIGTERM",
      summary: `Terminated ${agent.name} via Kill Switch`,
      created_at: now,
    });
    return { ok: true, target_id: targetId, killed_process: killedProc, agent: updatedAgent };
  }

  const session = stmts.getSession.get(targetId);
  if (session) {
    const agents = stmts.listAgentsBySession.all(session.id);
    for (const a of agents) {
      if (a.status !== "completed" && a.status !== "error") {
        stmts.updateAgent.run(null, "error", null, null, now, a.metadata, a.id);
        stmts.updateAgentTelemetry.run(
          null,
          null,
          null,
          null,
          null,
          "error",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          a.id
        );
        broadcast("agent_updated", stmts.getAgent.get(a.id));
      }
    }
    stmts.updateSession.run(null, "error", now, session.metadata, session.id);
    broadcast("session_updated", stmts.getSession.get(session.id));
    return { ok: true, target_id: targetId, killed_process: killedProc };
  }

  return { ok: true, target_id: targetId, killed_process: killedProc };
}

// POST /api/dispatch — Spawn Claude Code, Antigravity (agy), Dual Swarm, agy-cascade, or AGY Fan-Out Swarm
router.post("/", (req, res) => {
  const {
    prompt,
    engine = "claude",
    provider,
    model,
    claudeModel,
    antigravityModel,
    effort = "high",
    cwd,
  } = req.body || {};

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({
      error: { code: "MISSING_PROMPT", message: "A non-empty prompt is required" },
    });
  }

  const cleanPrompt = String(prompt).trim();
  const targetEngine = String(provider || engine || "claude")
    .toLowerCase()
    .trim();

  if (targetEngine === "cascade" || targetEngine === "agy-cascade") {
    const dispatched = spawnSingleProvider({
      provider: "agy-claude",
      prompt: cleanPrompt,
      model: model || "claude-opus-5-5-high",
      effort,
      cwd,
      mode: "cascade",
    });
    return res.status(201).json({
      ok: true,
      mode: "cascade",
      dispatches: [dispatched],
      dispatch: dispatched,
    });
  }

  if (targetEngine === "fanout" || targetEngine === "fan-out") {
    const dispatched = spawnSingleProvider({
      provider: "claude",
      prompt: cleanPrompt,
      model: claudeModel || "claude-opus-4-6",
      effort,
      cwd,
      mode: "fanout",
    });
    return res.status(201).json({
      ok: true,
      mode: "fanout",
      dispatches: [dispatched],
      dispatch: dispatched,
    });
  }

  if (targetEngine === "dual" || targetEngine === "swarm" || targetEngine === "both") {
    const claudeDispatch = spawnSingleProvider({
      provider: "claude",
      prompt: cleanPrompt,
      model:
        claudeModel ||
        (model && !model.includes("gemini") && !model.includes("argon")
          ? model
          : "claude-opus-4-6"),
      effort,
      cwd,
    });
    const agyDispatch = spawnSingleProvider({
      provider: "antigravity",
      prompt: cleanPrompt,
      model:
        antigravityModel ||
        (model && (model.includes("gemini") || model.includes("argon") || model.includes("flash"))
          ? model
          : "argon-4-ultra"),
      effort,
      cwd,
    });

    return res.status(201).json({
      ok: true,
      mode: "dual",
      dispatches: [claudeDispatch, agyDispatch],
    });
  }

  const singleProvider =
    targetEngine === "antigravity" || targetEngine === "agy" || targetEngine === "gemini"
      ? "antigravity"
      : targetEngine === "agy-claude"
        ? "agy-claude"
        : "claude";

  const dispatched = spawnSingleProvider({
    provider: singleProvider,
    prompt: cleanPrompt,
    model:
      model ||
      (singleProvider === "antigravity"
        ? "argon-4-ultra"
        : singleProvider === "agy-claude"
          ? "claude-opus-5-5-high"
          : "claude-sonnet-4-6"),
    effort,
    cwd,
  });

  return res.status(201).json({
    ok: true,
    mode: singleProvider,
    dispatches: [dispatched],
    dispatch: dispatched,
  });
});

// GET /api/dispatch/active — List active and recent dispatches + logs
router.get("/active", (_req, res) => {
  const list = Array.from(activeDispatches.values())
    .slice(-20)
    .reverse()
    .map((d) => ({
      dispatch_id: d.id,
      session_id: d.sessionId,
      agent_id: d.agentId,
      provider: d.provider,
      model: d.model,
      model_tier: d.model_tier,
      effort: d.effort,
      cwd: d.cwd,
      pid: d.pid,
      started_at: d.startedAt,
      status: d.status,
      logs: d.logs.slice(-50),
    }));
  res.json({ dispatches: list });
});

// POST /api/dispatch/:id/kill — Terminate a running agent or dispatch via SIGTERM
router.post("/:id/kill", (req, res) => {
  const result = killAgentOrDispatch(req.params.id);
  res.json(result);
});

router.killAgentOrDispatch = killAgentOrDispatch;
module.exports = router;
module.exports.exitFailureReason = exitFailureReason;
