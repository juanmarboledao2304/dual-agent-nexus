/**
 * @file CommandCenterDock.tsx
 * @description Persistent, collapsible bottom Unified Prompt Dispatcher & Process
 * Manager dock for DualAgent Nexus. Dispatches tasks to the `agy-cascade --yolo`
 * 3-Pool Waterfall, the AGY Fan-Out (3 Level-3 `invoke_subagent` units plus a
 * `===DIGEST===`), Claude Code CLI, Google Antigravity CLI (`agy`), or a Dual Swarm
 * (parallel mode). Offers one-click Quick Workflow Presets (Spec + agy-cascade --yolo,
 * 3-Unit Fan-Out + DIGEST, Haiku Fast Explore, Git Checkpoint + Diff Audit) that load
 * engine, model, effort, and a prompt template for review before dispatch, plus a
 * model override, 4-level reasoning effort selector, workspace path picker, live
 * stdout/stderr console, per-dispatch 8-bit sprites, and a SIGTERM kill switch.
 * Also renders inline (`variant="panel"`) inside the Launch panel, which replaced the floating dock.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useState, useEffect, useRef } from "react";
import type { ComponentType } from "react";
import { useLocation } from "react-router";
import {
  Terminal,
  Send,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  OctagonX,
  Cpu,
  Gauge,
  Layers,
  GitFork,
  GitCommit,
  FileCode2,
  Search,
  Columns2,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { getAgentThermalTheme } from "../utils/agentTheme";
import { resolveSpriteVariant } from "../utils/pixelSprites";
import type { PixelAvatarState, SpriteVariant } from "../utils/pixelSprites";
import { PixelAvatar } from "./PixelAvatar";
import type { WSMessage, DispatchStatusPayload } from "../lib/types";

type TargetEngine = "claude" | "antigravity" | "dual" | "cascade" | "fanout";
type EffortOption = "low" | "medium" | "high" | "max";

const CLAUDE_MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 (Heavy Conductor · Crimson)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Standard Execution · Orange)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Explore Scout · Amber)" },
];

const ANTIGRAVITY_MODELS = [
  { id: "argon-4-ultra", label: "Argon 4 Ultra (Deep Reasoning · Violet)" },
  { id: "gemini-3.2-pro-high", label: "Gemini 3.2 Pro High (Deep Reasoning · Violet)" },
  { id: "gemini-3-flow", label: "Gemini 3 Flow (Standard Agentic Flow · Sapphire)" },
  { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash High (Fan-Out · Emerald)" },
];

const CASCADE_MODELS = [
  {
    id: "claude-opus-5-5-thinking",
    label: "Waterfall start: Claude Opus 5.5 (Thinking) · Pool 1 AGY-Claude",
  },
  {
    id: "claude-sonnet-5-5-thinking",
    label: "Waterfall start: Claude Sonnet 5.5 (Thinking) · Pool 1 AGY-Claude",
  },
  {
    id: "gpt-oss-120b-medium",
    label: "Waterfall start: GPT-OSS 120B (Medium) · Pool 1 AGY-Claude",
  },
  {
    id: "gemini-3.2-pro-high",
    label: "Waterfall start: Gemini 3.2 Pro (High) · Pool 2 AGY-Gemini",
  },
  {
    id: "gemini-3.8-flash-high",
    label: "Waterfall start: Gemini 3.8 Flash (High) · Pool 2 AGY-Gemini",
  },
];

const DUAL_MODELS = [
  { id: "claude-opus-4-6", label: "Dual Heavy: Claude Opus 4.6 + Argon 4 Ultra" },
  { id: "claude-sonnet-4-6", label: "Dual Standard: Claude Sonnet 4.6 + Gemini 3 Flow" },
  { id: "claude-haiku-4-5", label: "Dual Fast: Claude Haiku 4.5 + Gemini 3.8 Flash" },
];

/** Model each engine starts on when selected. */
const DEFAULT_MODEL: Record<TargetEngine, string> = {
  claude: "claude-sonnet-4-6",
  antigravity: "gemini-3-flow",
  cascade: "claude-opus-5-5-thinking",
  fanout: "claude-opus-5-5-thinking",
  dual: "claude-opus-4-6",
};

const EFFORT_OPTIONS: Array<{ id: EffortOption; label: string; bars: 1 | 2 | 3 | 4 }> = [
  { id: "low", label: "Low", bars: 1 },
  { id: "medium", label: "Medium", bars: 2 },
  { id: "high", label: "High", bars: 3 },
  { id: "max", label: "Max", bars: 4 },
];

/** Engine selector buttons: label, sprite or icon, and active styling. */
const ENGINE_OPTIONS: Array<{
  id: TargetEngine;
  label: string;
  sprite?: SpriteVariant;
  icon?: ComponentType<{ className?: string }>;
  activeClass: string;
}> = [
  {
    id: "cascade",
    label: "agy-cascade --yolo",
    sprite: "agy-opus",
    activeClass: "bg-lilac-500/15 text-lilac-100 border-lilac-500/50",
  },
  {
    id: "fanout",
    label: "AGY Fan-Out (3 Units + DIGEST)",
    sprite: "gemini-flash",
    activeClass: "bg-glacier-500/15 text-glacier-100 border-glacier-500/50",
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    sprite: "claude-sonnet",
    activeClass: "bg-clay-500/15 text-clay-100 border-clay-500/50",
  },
  {
    id: "antigravity",
    label: "Antigravity CLI (agy)",
    sprite: "gemini-pro",
    activeClass: "bg-glacier-500/15 text-glacier-100 border-glacier-500/50",
  },
  {
    id: "dual",
    label: "Dual Swarm (Parallel)",
    icon: Columns2,
    activeClass: "bg-surface-4 text-gray-50 border-border-light",
  },
];

/** A one-click workflow preset: loads engine, model, effort, and a prompt template. */
export interface QuickPreset {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  engine: TargetEngine;
  model: string;
  effort: EffortOption;
  template: string;
}

/** Quick Workflow Presets, in dock order. */
export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "spec-cascade",
    label: "Spec + agy-cascade --yolo",
    description:
      "Write a locked spec, then delegate bulk implementation through the 3-pool waterfall",
    icon: FileCode2,
    engine: "cascade",
    model: "claude-opus-5-5-thinking",
    effort: "high",
    template:
      "Spec: <feature>. Write a locked, zero-discovery implementation plan with exact paths and interfaces, then delegate the bulk implementation via agy-cascade --yolo --digest and return a ===DIGEST=== block for verification.",
  },
  {
    id: "fanout-digest",
    label: "3-Unit Fan-Out + DIGEST",
    description: "Split work into three independent L3 units and merge one ===DIGEST===",
    icon: GitFork,
    engine: "fanout",
    model: "claude-opus-5-5-thinking",
    effort: "high",
    template:
      "Split <task> into 3 independent units (Unit 1: backend, Unit 2: UI, Unit 3: tests) with disjoint write scopes. Fan out via define_subagent + invoke_subagent, commit a git checkpoint per unit, and return a single ===DIGEST=== summary.",
  },
  {
    id: "haiku-explore",
    label: "Haiku Fast Explore",
    description: "Read-only reconnaissance on Pool 3 Claude Direct at low effort",
    icon: Search,
    engine: "claude",
    model: "claude-haiku-4-5",
    effort: "low",
    template:
      "Explore (read-only, no edits): map the files, symbols, and call paths involved in <topic>. Report a compact digest of findings with file:line references.",
  },
  {
    id: "git-checkpoint",
    label: "Git Checkpoint + Diff Audit",
    description: "Checkpoint the working tree, then audit the diff for regressions",
    icon: GitCommit,
    engine: "claude",
    model: "claude-sonnet-4-6",
    effort: "medium",
    template:
      'Create a git checkpoint (git add -A && git commit -m "checkpoint: <label>"), then audit git diff --stat HEAD~1 and the full diff for regressions, missing tests, and risky changes. Report findings ranked by severity.',
  },
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

/** Sprite and avatar state for a dispatch chip. */
function dispatchSprite(d: ActiveDispatchItem): {
  variant: SpriteVariant;
  state: PixelAvatarState;
} {
  const theme = getAgentThermalTheme({ provider: d.provider, model: d.model, effort: d.effort });
  const state: PixelAvatarState =
    d.status === "running"
      ? "working"
      : d.status === "completed"
        ? "completed"
        : d.status === "error" || d.status === "killed"
          ? "error"
          : "idle";
  return { variant: resolveSpriteVariant(theme.provider, theme.tier), state };
}

export function CommandCenterDock({ variant = "dock" }: { variant?: "dock" | "panel" } = {}) {
  const location = useLocation();
  // "panel" renders the expanded dispatcher inline (inside the Launch panel) with no collapse handle.
  const isPanel = variant === "panel";
  const [expanded, setExpanded] = useState(isPanel);
  const [activePoolLabel, setActivePoolLabel] = useState("Pool 1: AGY-Claude");
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [engine, setEngine] = useState<TargetEngine>("cascade");
  const [model, setModel] = useState(DEFAULT_MODEL.cascade);
  const [effort, setEffort] = useState<EffortOption>("high");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [activeDispatches, setActiveDispatches] = useState<ActiveDispatchItem[]>([]);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLPreElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const focusPromptOnExpand = useRef(false);

  // Auto-collapse when navigating between pages
  useEffect(() => {
    if (!isPanel) setExpanded(false);
  }, [location.pathname, isPanel]);

  // Focus the prompt once a preset has expanded the dock.
  useEffect(() => {
    if (expanded && focusPromptOnExpand.current) {
      focusPromptOnExpand.current = false;
      promptRef.current?.focus();
    }
  }, [expanded, prompt]);

  // Read initial cascade active pool
  useEffect(() => {
    api.cascade
      .status()
      .then((res) => {
        if (res?.active_pool === 2 || res?.active_pool_id === "agy-gemini") {
          setActivePoolLabel("Pool 2: AGY-Gemini");
        } else if (res?.active_pool === 3 || res?.active_pool_id === "claude-direct") {
          setActivePoolLabel("Pool 3: Claude Direct");
        } else {
          setActivePoolLabel("Pool 1: AGY-Claude");
        }
      })
      .catch(() => {});
  }, []);

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

  // Subscribe to live dispatch stream, status events, and cascade pool changes
  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "cascade:status" && msg.data) {
        const cData = msg.data as { active_pool?: string };
        if (cData.active_pool === "agy-gemini") {
          setActivePoolLabel("Pool 2: AGY-Gemini");
        } else if (cData.active_pool === "claude-direct") {
          setActivePoolLabel("Pool 3: Claude Direct");
        } else {
          setActivePoolLabel("Pool 1: AGY-Claude");
        }
      } else if (msg.type === "dispatch_stream" && msg.data) {
        const payload = msg.data as Record<string, unknown>;
        const raw =
          payload.chunk ?? payload.line ?? payload.text ?? payload.message ?? payload.output;
        if (!raw) return;
        const clean = String(raw).trim();
        if (!clean || clean === "undefined") return;

        const time = new Date().toLocaleTimeString([], {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        const provider = String(payload.provider || "");
        const prefix =
          provider === "agy-claude"
            ? "[AGY-CLAUDE]"
            : provider === "antigravity" || provider === "agy-gemini"
              ? "[AGY-GEMINI]"
              : "[CLAUDE]";

        setStreamLog((prev) => [...prev.slice(-150), `${time} ${prefix} ${clean}`]);
      } else if (msg.type === "dispatch_status" && msg.data) {
        const statusPayload = msg.data as DispatchStatusPayload;
        const id = statusPayload.dispatchId ?? statusPayload.dispatch_id;
        setActiveDispatches((prev) =>
          prev.map((d) => (d.dispatchId === id ? { ...d, status: statusPayload.status } : d))
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

  /** Switch engines and reset the model to that engine's default. */
  const selectEngine = (next: TargetEngine) => {
    setEngine(next);
    setModel(DEFAULT_MODEL[next]);
    setActivePresetId(null);
  };

  /** Load a preset into the dock for review; dispatching stays an explicit action. */
  const applyPreset = (preset: QuickPreset) => {
    setEngine(preset.engine);
    setModel(preset.model);
    setEffort(preset.effort);
    setPrompt(preset.template);
    setActivePresetId(preset.id);
    focusPromptOnExpand.current = true;
    setExpanded(true);
  };

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
      setActivePresetId(null);
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

  if (!expanded) {
    return (
      <div className="fixed bottom-0 right-0 left-0 z-40 pointer-events-none flex justify-center px-4 pb-2">
        <div className="pointer-events-auto w-full max-w-4xl h-12 rounded-xl border border-border-light bg-surface-1/95 backdrop-blur-xl shadow-lg flex items-center justify-between px-3 gap-2.5 transition-all">
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-surface-2 text-gray-100 border border-border hover:border-border-light transition-colors"
            >
              <Terminal className="w-3 h-3 text-gray-400" />
              <span>Command Center</span>
            </button>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-lilac-500/10 text-fuchsia-300 border border-fuchsia-500/30">
              <Layers className="w-2.5 h-2.5 text-fuchsia-400" />
              {activePoolLabel}
            </span>
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] bg-mint-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">
                {runningCount} active
              </span>
            )}
          </div>

          <div className="flex-1 max-w-sm mx-1">
            <input
              type="text"
              value={prompt}
              onFocus={() => setExpanded(true)}
              onClick={() => setExpanded(true)}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Quick prompt... (click to expand Command Center)"
              className="w-full bg-surface-2 text-xs text-gray-100 placeholder-gray-500 px-3 py-1.5 rounded-lg border border-border focus:border-accent focus:outline-none font-mono"
            />
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {QUICK_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  title={`${preset.label}: ${preset.description}`}
                  aria-label={preset.label}
                  className="hidden md:inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-gray-100 bg-surface-2 hover:bg-surface-3 border border-border transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 hover:bg-surface-3 text-gray-300 border border-border hover:text-white transition-colors"
            >
              <span>Expand</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isPanel
          ? ""
          : "fixed bottom-0 right-0 left-0 z-40 pointer-events-none flex justify-center px-4 pb-3"
      }
    >
      <div
        className={
          isPanel
            ? ""
            : "pointer-events-auto w-full max-w-5xl rounded-2xl border border-border-light bg-surface-1/95 backdrop-blur-xl shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.8)] overflow-hidden transition-all"
        }
      >
        {/* Top Collapsible Handle Bar (dock only) */}
        {!isPanel && (
          <div
            onClick={() => setExpanded(false)}
            className="cursor-pointer flex items-center justify-between gap-3 px-4 py-2 bg-surface-2 border-b border-border"
          >
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-surface-2 text-gray-100 border border-border">
                <Terminal className="w-3 h-3 text-gray-400" />
                Command Center Dock
              </span>
              <span className="text-[11px] text-gray-400 hidden sm:inline">
                Unified Dispatcher: agy-cascade Waterfall · AGY Fan-Out · Claude Code · Dual Swarm
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-lilac-500/10 text-fuchsia-300 border border-fuchsia-500/30">
                <Layers className="w-2.5 h-2.5 text-fuchsia-400" />
                {activePoolLabel}
              </span>
              {runningCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-mint-500/15 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  {runningCount} running
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="text-[11px] hidden md:inline">Ctrl/Cmd + Enter to run</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-300 hover:text-white bg-surface-3 hover:bg-surface-4 border border-border-light transition-colors"
              >
                <span>Collapse</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Expanded Dispatcher Controls + Live Stream Console */}
        <div className="p-5 space-y-3 border-b border-border animate-fade-in">
          {/* Quick Workflow Presets */}
          <div className="flex flex-wrap items-center gap-1.5" data-testid="quick-presets">
            <span className="micro-label mr-1">Quick Presets</span>
            {QUICK_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    active
                      ? "bg-accent-muted text-gray-50 border-accent/50"
                      : "bg-surface-2 text-gray-300 border-border hover:text-gray-100 hover:border-border-light"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Engine Selector + Reasoning Effort Selector */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {ENGINE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => selectEngine(opt.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      engine === opt.id
                        ? opt.activeClass
                        : "bg-surface-2 text-gray-400 border-border hover:text-gray-200"
                    }`}
                  >
                    {opt.sprite ? (
                      <PixelAvatar
                        variant={opt.sprite}
                        state="idle"
                        size={14}
                        framed={false}
                        indicator={false}
                        showBadge={false}
                      />
                    ) : Icon ? (
                      <Icon className="w-3.5 h-3.5" />
                    ) : null}
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Reasoning Effort Segmented Control */}
            <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg border border-border">
              <Gauge className="w-3.5 h-3.5 text-gray-400 ml-1.5 mr-1" />
              {EFFORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setEffort(opt.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    effort === opt.id
                      ? "bg-surface-4 text-gray-50 border border-border-light shadow-hairline"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <span className="flex items-end gap-px h-2.5" aria-hidden>
                    {[1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className={`w-0.5 ${bar <= opt.bars ? "bg-current" : "bg-surface-5"}`}
                        style={{ height: `${bar * 25}%` }}
                      />
                    ))}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model Override Dropdown & Workspace Path Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-lg border border-border">
              <Cpu className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-[11px] text-gray-400 flex-shrink-0">Model:</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model Override"
                className="bg-transparent text-xs font-mono text-gray-200 flex-1 focus:outline-none"
              >
                {modelChoices.map((m) => (
                  <option key={m.id} value={m.id} className="bg-surface-2 text-gray-200">
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-lg border border-border">
              <FolderOpen className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="text-[11px] text-gray-400 flex-shrink-0">Workspace:</span>
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="Default project directory..."
                aria-label="Workspace Path"
                className="bg-transparent text-xs font-mono text-gray-200 flex-1 focus:outline-none"
              />
            </div>
          </div>

          {/* Active Dispatches & Live Stream Console */}
          {(activeDispatches.length > 0 || streamLog.length > 0) && (
            <div className="rounded-xl bg-surface-2 border border-border p-2.5 space-y-2">
              {activeDispatches.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {activeDispatches.map((d) => {
                    const sprite = dispatchSprite(d);
                    return (
                      <div
                        key={d.dispatchId}
                        className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-surface-1 border border-border text-[11px] font-mono"
                      >
                        <PixelAvatar
                          variant={sprite.variant}
                          state={sprite.state}
                          size={16}
                          indicator={false}
                          showBadge={false}
                        />
                        <span className="text-gray-200">{d.provider}</span>
                        <span className="text-gray-400">{d.model}</span>
                        <span className="text-gray-500">({d.status})</span>
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
                    );
                  })}
                </div>
              )}

              {streamLog.length > 0 && (
                <pre
                  ref={consoleEndRef}
                  className="text-[11px] font-mono text-gray-300 bg-surface-1 p-2.5 rounded-lg border border-border max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed"
                >
                  {streamLog.join("\n")}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Prompt Bar in Expanded Mode */}
        <div className="flex items-center gap-2 px-5 py-3 bg-surface-1">
          <textarea
            ref={promptRef}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleDispatch();
              }
            }}
            placeholder="Dispatch via agy-cascade --yolo, AGY Fan-Out, Claude Code, or Dual Swarm... (Ctrl/Cmd + Enter)"
            className="flex-1 bg-surface-2 text-[13px] text-gray-100 placeholder-gray-500 px-3 py-2 rounded-xl border border-border focus:border-accent focus:outline-none resize-none"
          />
          <button
            type="button"
            onClick={handleDispatch}
            disabled={dispatching || !prompt.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-accent-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{dispatching ? "Spawning..." : "Dispatch"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
