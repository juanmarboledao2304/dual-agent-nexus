/**
 * @file CommandCenterDock.tsx
 * @description Persistent, collapsible bottom Unified Prompt Dispatcher & Process
 * Manager dock for DualAgent Nexus. Allows operators to dispatch tasks to
 * Claude Code CLI (Warm Spectrum), Google Antigravity CLI (`agy`, Cool Spectrum),
 * Dual Swarm (Parallel Mode), `🌊 agy-cascade --yolo` (3-Pool Waterfall), or
 * `🪭 AGY Fan-Out Swarm (3x Subagents + Digest)` (Level-2-to-Level-3 internal
 * `invoke_subagent` fan-out), with dynamic model override, 4-level reasoning
 * effort selector, workspace path picker, real-time stdout/stderr stream console,
 * and SIGTERM process kill switch.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useState, useEffect, useRef } from "react";
import {
  Terminal,
  Send,
  Flame,
  Sparkles,
  Zap,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  OctagonX,
  Cpu,
  Gauge,
  Waves,
  GitFork,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import type { WSMessage, DispatchStreamPayload, DispatchStatusPayload } from "../lib/types";

type TargetEngine = "claude" | "antigravity" | "dual" | "cascade" | "fanout";
type EffortOption = "low" | "medium" | "high" | "max";

const CLAUDE_MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 (Heavy Orchestrator · Red)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Balanced Execution · Orange)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Fast Recon · Amber Yellow)" },
];

const ANTIGRAVITY_MODELS = [
  { id: "argon-4-ultra", label: "Argon 4 Ultra (Deep Reasoning · Electric Purple)" },
  { id: "gemini-3.2-pro-high", label: "Gemini 3.2 Pro High (Deep Reasoning · Electric Purple)" },
  { id: "gemini-3-flow", label: "Gemini 3 Flow (Standard Agentic Flow · Cyber Blue)" },
  { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash High (High-Speed · Emerald Green)" },
];

const CASCADE_MODELS = [
  {
    id: "claude-opus-5-5-thinking",
    label: "Waterfall Start: Claude Opus 5.5 (Thinking) ➔ Pool 1 [AGY • claude pool]",
  },
  {
    id: "claude-sonnet-5-5-thinking",
    label: "Waterfall Start: Claude Sonnet 5.5 (Thinking) ➔ Pool 1 [AGY • claude pool]",
  },
  {
    id: "gpt-oss-120b-medium",
    label: "Waterfall Start: GPT-OSS 120B (Medium) ➔ Pool 1 [AGY • claude pool]",
  },
  {
    id: "gemini-3.2-pro-high",
    label: "Waterfall Start: Gemini 3.2 Pro (High) ➔ Pool 2 [AGY • gemini pool]",
  },
  {
    id: "gemini-3.8-flash-high",
    label: "Waterfall Start: Gemini 3.8 Flash (High) ➔ Pool 2 [AGY • gemini pool]",
  },
];

const DUAL_MODELS = [
  { id: "claude-opus-4-6", label: "Dual Heavy: Claude Opus 4.6 + Argon 4 Ultra" },
  { id: "claude-sonnet-4-6", label: "Dual Standard: Claude Sonnet 4.6 + Gemini 3 Flow" },
  { id: "claude-haiku-4-5", label: "Dual Fast: Claude Haiku 4.5 + Gemini 3.8 Flash" },
];

const EFFORT_OPTIONS: Array<{ id: EffortOption; label: string; badge: string }> = [
  { id: "low", label: "Low ⚡", badge: "LOW" },
  { id: "medium", label: "Medium ⚙️", badge: "MED" },
  { id: "high", label: "High 🧠", badge: "HIGH" },
  { id: "max", label: "Max 🔥", badge: "MAX" },
];

interface ActiveDispatchItem {
  dispatchId: string;
  sessionId: string;
  agentId: string;
  provider: string;
  model: string;
  effort: string;
  status: string;
}

export function CommandCenterDock() {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [engine, setEngine] = useState<TargetEngine>("cascade");
  const [model, setModel] = useState("claude-opus-5-5-thinking");
  const [effort, setEffort] = useState<EffortOption>("high");
  const [dispatching, setDispatching] = useState(false);
  const [activeDispatches, setActiveDispatches] = useState<ActiveDispatchItem[]>([]);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLPreElement>(null);

  // Load default workspace path suggestion once
  useEffect(() => {
    api.run
      .cwds()
      .then((res) => {
        const dash = res.items.find((i) => i.kind === "dashboard") || res.items[0];
        if (dash && !cwd) setCwd(dash.path);
      })
      .catch(() => {});
  }, []);

  // Update default model when engine changes
  useEffect(() => {
    if (engine === "claude") {
      setModel("claude-sonnet-4-6");
    } else if (engine === "antigravity") {
      setModel("gemini-3-flow");
    } else if (engine === "cascade" || engine === "fanout") {
      setModel("claude-opus-5-5-thinking");
    } else {
      setModel("claude-opus-4-6");
    }
  }, [engine]);

  // Subscribe to live dispatch stream & status events
  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "dispatch_stream" && msg.data) {
        const payload = msg.data as DispatchStreamPayload;
        const prefix =
          payload.provider === "agy-claude"
            ? "[AGY•CLAUDE]"
            : payload.provider === "antigravity" || payload.provider === "agy-gemini"
              ? "[AGY•GEMINI]"
              : "[CLAUDE]";
        setStreamLog((prev) => [...prev.slice(-100), `${prefix} ${payload.chunk}`]);
      } else if (msg.type === "dispatch_status" && msg.data) {
        const statusPayload = msg.data as DispatchStatusPayload;
        setActiveDispatches((prev) =>
          prev.map((d) =>
            d.dispatchId === statusPayload.dispatchId ? { ...d, status: statusPayload.status } : d
          )
        );
      }
    });
  }, []);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollTop = consoleEndRef.current.scrollHeight;
    }
  }, [streamLog]);

  const modelChoices =
    engine === "claude"
      ? CLAUDE_MODELS
      : engine === "antigravity"
        ? ANTIGRAVITY_MODELS
        : engine === "cascade" || engine === "fanout"
          ? CASCADE_MODELS
          : DUAL_MODELS;

  const handleDispatch = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || dispatching) return;
    setDispatching(true);
    setExpanded(true);
    try {
      const res = await api.dispatch.start({
        prompt: trimmed,
        cwd: cwd.trim() || undefined,
        engine,
        model,
        effort,
      });
      const newItems: ActiveDispatchItem[] = res.dispatches.map((d) => ({
        dispatchId: d.dispatchId,
        sessionId: d.sessionId,
        agentId: d.agentId,
        provider: d.provider,
        model: d.model,
        effort: d.effort,
        status: "running",
      }));
      setActiveDispatches((prev) => [...newItems, ...prev.slice(0, 5)]);
      setStreamLog((prev) => [
        ...prev,
        `>>> Dispatched (${engine.toUpperCase()} · ${effort.toUpperCase()}): "${trimmed}"\n`,
      ]);
      setPrompt("");
    } catch (err) {
      setStreamLog((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : "Failed to dispatch prompt"}\n`,
      ]);
    } finally {
      setDispatching(false);
    }
  };

  const handleKillDispatch = async (dispatchId: string) => {
    try {
      await api.dispatch.kill(dispatchId);
      setActiveDispatches((prev) =>
        prev.map((d) => (d.dispatchId === dispatchId ? { ...d, status: "killed" } : d))
      );
      setStreamLog((prev) => [...prev, `[SIGTERM] Terminated dispatch ${dispatchId}\n`]);
    } catch {
      // Ignore error
    }
  };

  const runningCount = activeDispatches.filter((d) => d.status === "running").length;

  return (
    <div className="fixed bottom-0 right-0 left-0 z-40 pointer-events-none flex justify-center px-4 pb-3">
      <div className="pointer-events-auto w-full max-w-5xl rounded-2xl border border-slate-700/90 bg-slate-950/95 backdrop-blur-xl shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.8)] overflow-hidden transition-all">
        {/* Top Collapsible Handle Bar */}
        <div
          onClick={() => setExpanded((v) => !v)}
          className="cursor-pointer flex items-center justify-between gap-3 px-4 py-2 bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900 border-b border-slate-800/80"
        >
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500/20 via-fuchsia-500/20 to-cyan-500/20 text-slate-100 border border-slate-700">
              <Terminal className="w-3 h-3 text-amber-400" />
              Command Center Dock
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Unified Dispatcher — `agy-cascade` Waterfall · AGY Fan-Out · Claude Code · Dual Swarm
            </span>
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">
                {runningCount} running
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="text-[10px] font-mono hidden md:inline">Ctrl/⌘ + Enter to Run</span>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
        </div>

        {/* Expanded Dispatcher Controls + Live Stream Console */}
        {expanded && (
          <div className="p-4 space-y-3 border-b border-slate-800/80 animate-fade-in">
            {/* Engine Selector + Reasoning Effort Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Target Engine Selector */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEngine("cascade")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    engine === "cascade"
                      ? "bg-gradient-to-r from-fuchsia-600/35 to-purple-500/35 text-fuchsia-200 border-fuchsia-400/70 shadow-[0_0_16px_-3px_rgba(217,70,239,0.5)]"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Waves className="w-3.5 h-3.5 text-fuchsia-400" />
                  🌊 agy-cascade --yolo
                </button>

                <button
                  type="button"
                  onClick={() => setEngine("fanout")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    engine === "fanout"
                      ? "bg-gradient-to-r from-indigo-600/35 via-blue-500/35 to-emerald-500/35 text-cyan-200 border-cyan-400/70 shadow-[0_0_16px_-3px_rgba(16,185,129,0.5)]"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <GitFork className="w-3.5 h-3.5 text-emerald-400" />
                  🪭 AGY Fan-Out Swarm (3x Subagents + Digest)
                </button>

                <button
                  type="button"
                  onClick={() => setEngine("claude")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    engine === "claude"
                      ? "bg-gradient-to-r from-red-600/30 to-orange-500/30 text-orange-200 border-orange-500/60 shadow-[0_0_15px_-3px_rgba(249,115,22,0.45)]"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                  Claude Code CLI
                </button>

                <button
                  type="button"
                  onClick={() => setEngine("antigravity")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    engine === "antigravity"
                      ? "bg-gradient-to-r from-purple-600/30 to-blue-500/30 text-cyan-200 border-blue-500/60 shadow-[0_0_15px_-3px_rgba(59,130,246,0.45)]"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  Antigravity CLI (agy)
                </button>

                <button
                  type="button"
                  onClick={() => setEngine("dual")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    engine === "dual"
                      ? "bg-gradient-to-r from-orange-600/30 via-purple-600/30 to-emerald-500/30 text-amber-100 border-purple-400/60 shadow-[0_0_18px_-3px_rgba(168,85,247,0.5)]"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  Dual Swarm (Parallel)
                </button>
              </div>

              {/* Reasoning Effort Segmented Control */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                <Gauge className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
                {EFFORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setEffort(opt.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                      effort === opt.id
                        ? "bg-slate-800 text-amber-300 border border-amber-500/40 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Override Dropdown & Workspace Path Selector */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
                <Cpu className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-[11px] text-slate-400 flex-shrink-0">Model:</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label="Model Override"
                  className="bg-transparent text-xs font-mono text-slate-200 flex-1 focus:outline-none"
                >
                  {modelChoices.map((m) => (
                    <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
                <FolderOpen className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-[11px] text-slate-400 flex-shrink-0">Workspace:</span>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="Default project directory..."
                  aria-label="Workspace Path"
                  className="bg-transparent text-xs font-mono text-slate-200 flex-1 focus:outline-none"
                />
              </div>
            </div>

            {/* Active Dispatches & Live Stream Console */}
            {(activeDispatches.length > 0 || streamLog.length > 0) && (
              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-2.5 space-y-2">
                {activeDispatches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {activeDispatches.map((d) => (
                      <div
                        key={d.dispatchId}
                        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono"
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            d.status === "running"
                              ? d.provider === "agy-claude"
                                ? "bg-fuchsia-400 animate-ping"
                                : d.provider === "antigravity"
                                  ? "bg-cyan-400 animate-ping"
                                  : "bg-orange-400 animate-ping"
                              : "bg-slate-500"
                          }`}
                        />
                        <span className="text-slate-200 uppercase">{d.provider}</span>
                        <span className="text-slate-400">{d.model}</span>
                        <span className="text-slate-500">({d.status})</span>
                        {d.status === "running" && (
                          <button
                            type="button"
                            onClick={() => handleKillDispatch(d.dispatchId)}
                            className="text-red-400 hover:text-red-300 ml-1"
                            title="Kill Process (SIGTERM)"
                          >
                            <OctagonX className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {streamLog.length > 0 && (
                  <pre
                    ref={consoleEndRef}
                    className="text-[11px] font-mono text-emerald-300/90 bg-slate-950 p-2.5 rounded-lg border border-slate-800/90 max-h-32 overflow-y-auto whitespace-pre-wrap"
                  >
                    {streamLog.join("")}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {/* Always-Accessible Prompt Bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-950">
          <textarea
            rows={expanded ? 2 : 1}
            value={prompt}
            onFocus={() => setExpanded(true)}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleDispatch();
              }
            }}
            placeholder="Dispatch via 🌊 agy-cascade --yolo, 🪭 AGY Fan-Out Swarm, Claude Code, or Dual Swarm... (Ctrl/⌘ + Enter)"
            className="flex-1 bg-slate-900/90 text-xs text-slate-100 placeholder-slate-500 px-3 py-2 rounded-xl border border-slate-800 focus:border-amber-500/50 focus:outline-none resize-none font-mono"
          />
          <button
            type="button"
            onClick={handleDispatch}
            disabled={dispatching || !prompt.trim()}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              engine === "claude"
                ? "bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-500 hover:to-orange-400 text-white"
                : engine === "antigravity"
                  ? "bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 text-white"
                  : engine === "cascade"
                    ? "bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white"
                    : engine === "fanout"
                      ? "bg-gradient-to-r from-indigo-600 via-blue-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white"
                      : "bg-gradient-to-r from-orange-600 via-purple-600 to-blue-600 hover:from-orange-500 hover:to-blue-500 text-white"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{dispatching ? "Spawning..." : "Dispatch"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
