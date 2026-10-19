/**
 * @file AgentInspectorDrawer.tsx
 * @description Slide-over inspector drawer that opens when clicking any node in the
 * Subagent Hierarchy Graph or Agent Card. Displays the agent's Chromatic Thermal
 * telemetry, 4-bar Effort Signal Meter, expandable `===DIGEST===` Execution Summary,
 * Git Checkpoint commit history, system prompt / task description, live
 * tool call & reasoning trace, stdout/stderr stream, and a SIGTERM process kill switch.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useState, useCallback } from "react";
import {
  X,
  OctagonX,
  ExternalLink,
  Cpu,
  Wrench,
  Terminal,
  Sparkles,
  Flame,
  Clock,
  Activity,
  Layers,
  ShieldCheck,
  GitCommit,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import {
  getAgentThermalTheme,
  formatAgentModelBadge,
  parseAgentMetadata,
} from "../utils/agentTheme";
import { timeAgo } from "../lib/format";
import type {
  Agent,
  DashboardEvent,
  Session,
  WSMessage,
  DispatchStreamPayload,
} from "../lib/types";

interface AgentInspectorDrawerProps {
  agent: Agent | null;
  session?: Session | null;
  onClose: () => void;
  onAgentUpdated?: () => void;
}

export function AgentInspectorDrawer({
  agent,
  session,
  onClose,
  onAgentUpdated,
}: AgentInspectorDrawerProps) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [killing, setKilling] = useState(false);
  const [digestExpanded, setDigestExpanded] = useState(true);

  const loadAgentEvents = useCallback(async () => {
    if (!agent) return;
    try {
      const res = await api.events.list({
        session_id: agent.session_id,
        limit: 40,
      });
      setEvents(res.events);
    } catch {
      // Ignore fetch errors in inspector
    }
  }, [agent]);

  useEffect(() => {
    setStreamLines([]);
    void loadAgentEvents();
  }, [agent?.id, loadAgentEvents]);

  useEffect(() => {
    if (!agent) return;
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "new_event") {
        const ev = msg.data as DashboardEvent;
        if (ev.session_id === agent.session_id) {
          setEvents((prev) => [ev, ...prev.slice(0, 49)]);
        }
      } else if (msg.type === "dispatch_stream" && msg.data) {
        const payload = msg.data as DispatchStreamPayload;
        if (payload.sessionId === agent.session_id || payload.agentId === agent.id) {
          setStreamLines((prev) => [...prev.slice(-80), payload.chunk]);
        }
      }
    });
  }, [agent]);

  if (!agent) return null;

  const theme = getAgentThermalTheme(agent, session?.provider, session?.model);
  const modelBadge = formatAgentModelBadge(agent.model || session?.model, theme.provider);
  const meta = parseAgentMetadata(agent.metadata);
  const roleBadge =
    agent.subagent_role || agent.subagent_type || (agent.type === "main" ? "Main" : "Subagent");
  const isActive = agent.status !== "completed" && agent.status !== "error";

  const inTokens = agent.input_tokens ?? 0;
  const outTokens = agent.output_tokens ?? 0;
  const cacheTokens = agent.cache_read_tokens ?? 0;
  const ctxPct = Math.min(100, Math.max(0, agent.context_utilization_pct ?? 0));

  const handleKill = async () => {
    if (killing) return;
    setKilling(true);
    try {
      await api.agents.kill(agent.id);
      onAgentUpdated?.();
    } catch {
      // Ignore error
    } finally {
      setKilling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className={`relative w-full max-w-xl h-full bg-slate-950 border-l-2 ${theme.borderClass} flex flex-col shadow-2xl overflow-hidden`}
      >
        {/* Header */}
        <div className={`p-5 border-b border-slate-800 ${theme.bgGradientClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${theme.providerPillClass}`}
                >
                  {theme.provider === "claude" ? (
                    <Flame className="w-3 h-3" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {theme.providerLabel}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${theme.badgeClass}`}
                >
                  {roleBadge}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900/90 text-slate-200 border border-slate-700/80">
                  {modelBadge}
                </span>
                {/* 4-Bar Effort Signal Meter */}
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-[10px] font-mono text-slate-300"
                  title={`Reasoning Effort: ${theme.effortLabel}`}
                >
                  <span className="flex items-end gap-0.5 h-3">
                    {[1, 2, 3, 4].map((bar) => (
                      <span
                        key={bar}
                        className={`w-1 rounded-sm transition-all ${
                          bar <= theme.effortBars ? theme.barActiveClass : "bg-slate-700/50"
                        }`}
                        style={{ height: `${bar * 25}%` }}
                      />
                    ))}
                  </span>
                  <span>{theme.effortLabel}</span>
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-100 truncate" title={agent.name}>
                {agent.name}
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Agent ID: {agent.id} · Session: {agent.session_id.slice(0, 12)}
                {agent.pid ? ` · PID: ${agent.pid}` : ""}
                {meta.conversation_id ? ` · Conv: ${meta.conversation_id}` : ""}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
              aria-label="Close Inspector"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/sessions/${agent.session_id}`);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Full Session
            </button>

            {isActive && (
              <button
                type="button"
                onClick={handleKill}
                disabled={killing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 transition-colors ml-auto"
              >
                <OctagonX className="w-3.5 h-3.5" />
                {killing ? "Sending SIGTERM..." : "Stop / Kill Process (SIGTERM)"}
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Expandable ===DIGEST=== Execution Summary Box */}
          {(meta.digest || meta.digest_received) && (
            <div className="p-4 rounded-xl bg-emerald-950/25 border border-emerald-500/40 space-y-2.5">
              <div
                onClick={() => setDigestExpanded((v) => !v)}
                className="cursor-pointer flex items-center justify-between gap-2"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ===DIGEST=== Execution Summary
                </span>
                <div className="flex items-center gap-2">
                  {meta.digest?.offloaded_tokens_saved ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">
                      {(meta.digest.offloaded_tokens_saved / 1000).toFixed(1)}K tokens saved
                    </span>
                  ) : null}
                  {digestExpanded ? (
                    <ChevronUp className="w-4 h-4 text-emerald-300" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-emerald-300" />
                  )}
                </div>
              </div>

              {digestExpanded && (
                <div className="space-y-1.5 text-xs font-mono bg-slate-950/90 p-3 rounded-lg border border-emerald-500/30 text-slate-200">
                  {meta.digest?.status && (
                    <p>
                      <span className="text-emerald-400">Status:</span> {meta.digest.status}
                    </p>
                  )}
                  {meta.digest?.files_touched && meta.digest.files_touched.length > 0 && (
                    <p>
                      <span className="text-emerald-400">Files Touched:</span>{" "}
                      {meta.digest.files_touched.join(", ")}
                    </p>
                  )}
                  {meta.digest?.key_findings && (
                    <p>
                      <span className="text-emerald-400">Key Findings:</span>{" "}
                      {meta.digest.key_findings}
                    </p>
                  )}
                  {meta.digest?.follow_ups && (
                    <p>
                      <span className="text-emerald-400">Follow-Ups:</span> {meta.digest.follow_ups}
                    </p>
                  )}
                  {!meta.digest?.status && meta.digest?.raw && (
                    <pre className="whitespace-pre-wrap text-[11px] text-emerald-200">
                      {meta.digest.raw}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Git Checkpoint Verification Commits */}
          {meta.git_checkpoints && meta.git_checkpoints > 0 ? (
            <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/35 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                  <GitCommit className="w-4 h-4 text-cyan-400" />
                  Git Checkpoint Protocol ({meta.git_checkpoints} checkpoint
                  {meta.git_checkpoints === 1 ? "" : "s"})
                </span>
                <span className="text-[10px] font-mono text-cyan-400">git diff verified</span>
              </div>
              {meta.git_checkpoint_commits && meta.git_checkpoint_commits.length > 0 && (
                <div className="space-y-1 font-mono text-[11px] bg-slate-950/90 p-2.5 rounded-lg border border-cyan-500/25 text-cyan-200">
                  {meta.git_checkpoint_commits.map((msg, idx) => (
                    <div key={`${idx}-${msg}`} className="flex items-center gap-2">
                      <span className="text-cyan-500">●</span>
                      <span className="truncate">{msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Telemetry & Context Window Utilization */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Context Window &amp; Token Telemetry
              </span>
              <span className="font-mono text-slate-200">{ctxPct.toFixed(1)}% utilized</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${theme.barActiveClass}`}
                style={{ width: `${Math.max(2, ctxPct)}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80">
                <p className="text-[10px] uppercase text-slate-500">Input Tokens</p>
                <p className="text-xs font-mono font-bold text-slate-200">
                  {inTokens.toLocaleString()}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80">
                <p className="text-[10px] uppercase text-slate-500">Output Tokens</p>
                <p className="text-xs font-mono font-bold text-slate-200">
                  {outTokens.toLocaleString()}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80">
                <p className="text-[10px] uppercase text-slate-500">Cache Hits</p>
                <p className="text-xs font-mono font-bold text-emerald-400">
                  {cacheTokens.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* System Prompt / Delegated Task */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />
              Assigned Prompt / Delegated Objective
            </h3>
            <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap font-mono bg-slate-950/90 p-3 rounded-lg border border-slate-800/80">
              {agent.task || session?.prompt_preview || "Autonomous agent execution in progress."}
            </p>
          </div>

          {/* Live Stream Output (if any) */}
          {streamLines.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                Live Process Stream (stdout / stderr)
              </h3>
              <pre className="text-[11px] font-mono text-emerald-300 bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {streamLines.join("")}
              </pre>
            </div>
          )}

          {/* Tool Call & Reasoning Trace */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                Reasoning Trace &amp; Tool Call History
              </h3>
              <span className="text-[11px] font-mono text-slate-500">{events.length} events</span>
            </div>

            {events.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No tool call events recorded for this session yet.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {events.map((ev, idx) => (
                  <div
                    key={ev.id ?? idx}
                    className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/80 flex items-start gap-2.5 text-xs"
                  >
                    <Wrench className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-200">
                          {ev.tool_name || ev.event_type}
                        </span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-1 flex-shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {timeAgo(ev.created_at)}
                        </span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5 break-words">
                        {ev.summary || ev.event_type}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
