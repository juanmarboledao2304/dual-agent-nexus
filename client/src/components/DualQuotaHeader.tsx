/**
 * @file DualQuotaHeader.tsx
 * @description Top Dual-Subscription Telemetry Header for DualAgent Nexus.
 * Displays side-by-side real-time gauges for the Claude Code Subscription (Warm
 * Spectrum: Crimson Red / Vibrant Orange / Amber Yellow) and the Google Antigravity
 * Subscription (Cool Spectrum: Electric Purple / Cyber Blue / Emerald Green),
 * along with the 1-Click Live Multi-Agent Swarm Simulator button and a collapsible
 * Chromatic Thermal Spectrum legend.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useState, useCallback } from "react";
import {
  Flame,
  Sparkles,
  Zap,
  Activity,
  Palette,
  Clock,
  Layers,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { THERMAL_LEGEND_ITEMS } from "../utils/agentTheme";
import type { DualQuotaTelemetry, WSMessage } from "../lib/types";

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtEstHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "∞";
  if (hours > 48) return ">48h";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${hours.toFixed(1)}h`;
}

export function DualQuotaHeader() {
  const [quota, setQuota] = useState<DualQuotaTelemetry | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const loadQuota = useCallback(async () => {
    try {
      const data = await api.quota.get();
      setQuota(data);
    } catch {
      // Fail-safe: leave previous telemetry in place if server is momentarily unreachable
    }
  }, []);

  useEffect(() => {
    void loadQuota();
    const interval = setInterval(loadQuota, 6000);
    return () => clearInterval(interval);
  }, [loadQuota]);

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "quota_updated" && msg.data) {
        setQuota(msg.data as DualQuotaTelemetry);
      } else if (msg.type === "swarm_simulation_started") {
        setSimulating(true);
      } else if (msg.type === "swarm_simulation_completed") {
        setSimulating(false);
        setSimMessage(null);
        void loadQuota();
      } else if (
        msg.type === "agent_created" ||
        msg.type === "agent_updated" ||
        msg.type === "new_event"
      ) {
        void loadQuota();
      }
    });
  }, [loadQuota]);

  const handleSimulateSwarm = async () => {
    if (simulating) return;
    setSimulating(true);
    setSimMessage("Launching Claude Opus + Antigravity Argon Swarm...");
    try {
      const res = await api.simulate.swarm();
      setSimMessage(res.message);
      void loadQuota();
    } catch (err) {
      setSimulating(false);
      setSimMessage(err instanceof Error ? err.message : "Failed to start swarm");
      setTimeout(() => setSimMessage(null), 4000);
    }
  };

  const claude = quota?.claude ?? {
    provider: "claude" as const,
    label: "Claude Code Subscription",
    window_5h_tokens: 0,
    window_5h_cap: 2_500_000,
    window_5h_utilization_pct: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_efficiency_pct: 0,
    active_subagents: { heavy: 0, standard: 0, light: 0 },
    burn_rate_tokens_per_hr: 0,
    est_hours_to_cap: null,
  };

  const agy = quota?.antigravity ?? {
    provider: "antigravity" as const,
    label: "Google Antigravity (agy)",
    session_tokens: 0,
    session_cap: 5_000_000,
    context_bandwidth_pct: 0,
    bytes_processed: 0,
    flow_credits_used: 0,
    flow_credits_limit: 500,
    active_subagents: { heavy: 0, standard: 0, light: 0 },
    model_distribution: { flash_pct: 50, pro_argon_pct: 50 },
    burn_rate_tokens_per_hr: 0,
    burn_rate_requests_per_hr: 0,
  };

  const agyUtilizationPct =
    agy.session_cap > 0 ? Math.min(100, (agy.session_tokens / agy.session_cap) * 100) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-xl">
      {/* Top Mission Control Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 border-b border-slate-800/60">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gradient-to-r from-red-500/20 via-orange-500/15 to-blue-500/20 border border-slate-700/80">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-orange-300 via-amber-200 to-cyan-300 bg-clip-text text-transparent">
              DualAgent Nexus
            </span>
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <span className="hidden md:inline-block text-[11px] text-slate-400 truncate">
            Unified Claude Code &amp; Google Antigravity Mission Control
          </span>
          {simMessage && (
            <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded animate-pulse truncate max-w-xs">
              {simMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLegend((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 transition-colors"
            title="Toggle Chromatic Thermal Spectrum Legend"
          >
            <Palette className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Thermal Spectrum</span>
          </button>

          <button
            type="button"
            onClick={handleSimulateSwarm}
            disabled={simulating}
            data-testid="simulate-swarm-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all border ${
              simulating
                ? "bg-gradient-to-r from-red-600/30 via-amber-500/30 to-emerald-500/30 text-amber-200 border-amber-400/50 shadow-[0_0_20px_-4px_rgba(251,191,36,0.5)] cursor-wait"
                : "bg-gradient-to-r from-orange-600 via-red-600 to-purple-600 hover:from-orange-500 hover:via-red-500 hover:to-purple-500 text-white border-orange-400/40 shadow-[0_0_18px_-4px_rgba(249,115,22,0.55)]"
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${simulating ? "animate-spin text-amber-300" : ""}`} />
            <span>{simulating ? "Swarm Active (25s)..." : "⚡ Simulate Swarm"}</span>
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors"
            title={collapsed ? "Expand Dual Quota Telemetry" : "Collapse Dual Quota Telemetry"}
            aria-label="Toggle Quota Telemetry Wings"
          >
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Collapsible Chromatic Thermal Spectrum Legend */}
      {showLegend && (
        <div className="px-5 py-3 bg-slate-900/95 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 animate-fade-in">
          {THERMAL_LEGEND_ITEMS.map((item) => (
            <div
              key={`${item.provider}-${item.tier}`}
              className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/80 border border-slate-800/90"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                style={{
                  backgroundColor: item.hex,
                  boxShadow: `0 0 10px ${item.hex}`,
                }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200">
                    {item.colorName}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-slate-400 truncate">{item.models}</p>
                <p className="text-[10px] text-slate-500 truncate">{item.role}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dual Telemetry Wings */}
      {!collapsed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-5 py-3">
          {/* LEFT WING: Warm Gradient — Claude Code Subscription */}
          <div className="relative overflow-hidden rounded-xl border border-orange-500/30 bg-gradient-to-br from-red-950/35 via-slate-900/90 to-amber-950/25 p-3.5 shadow-[0_0_25px_-8px_rgba(249,115,22,0.3)]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
                  <Flame className="w-3 h-3 text-orange-400" />
                  CLAUDE CODE SUBSCRIPTION
                </span>
                <span className="text-[11px] font-mono text-amber-300/90">
                  5h Window: {fmtCompact(claude.window_5h_tokens)} /{" "}
                  {fmtCompact(claude.window_5h_cap)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                  Cache Eff: {claude.cache_efficiency_pct.toFixed(1)}%
                </span>
                <span className="text-orange-300 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {fmtCompact(claude.burn_rate_tokens_per_hr)}/hr
                </span>
                <span className="text-slate-400 flex items-center gap-1" title="Est. time to cap">
                  <Clock className="w-3 h-3" />
                  {fmtEstHours(claude.est_hours_to_cap)}
                </span>
              </div>
            </div>

            {/* 5h Rolling Window Progress Bar */}
            <div className="w-full h-2 rounded-full bg-slate-950/90 border border-orange-500/20 overflow-hidden mb-2.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 transition-all duration-500"
                style={{
                  width: `${Math.max(2, Math.min(100, claude.window_5h_utilization_pct))}%`,
                }}
              />
            </div>

            {/* Active Subagent Breakdown: Red / Orange / Yellow */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-500/15 text-red-300 border border-red-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
                  Heavy/Opus: <strong>{claude.active_subagents.heavy}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_#f97316]" />
                  Standard/Sonnet: <strong>{claude.active_subagents.standard}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-200 border border-amber-400/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
                  Light/Haiku: <strong>{claude.active_subagents.light}</strong>
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                In {fmtCompact(claude.input_tokens)} · Out {fmtCompact(claude.output_tokens)} ·
                Cache {fmtCompact(claude.cache_read_tokens)}
              </span>
            </div>
          </div>

          {/* RIGHT WING: Cool Gradient — Google Antigravity Subscription */}
          <div className="relative overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-br from-purple-950/35 via-slate-900/90 to-emerald-950/25 p-3.5 shadow-[0_0_25px_-8px_rgba(59,130,246,0.3)]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-cyan-300 border border-blue-500/40">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  GOOGLE ANTIGRAVITY (AGY)
                </span>
                <span className="text-[11px] font-mono text-cyan-300/90">
                  Flow Credits: {agy.flow_credits_used} / {agy.flow_credits_limit} · Bandwidth:{" "}
                  {agy.context_bandwidth_pct.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className="text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded">
                  3.8-Flash:Pro {agy.model_distribution.flash_pct}% :{" "}
                  {agy.model_distribution.pro_argon_pct}%
                </span>
                <span className="text-cyan-300 flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  {agy.burn_rate_requests_per_hr}/hr reqs ·{" "}
                  {fmtCompact(agy.burn_rate_tokens_per_hr)}/hr
                </span>
              </div>
            </div>

            {/* Session Quota & Context Bandwidth Progress Bar */}
            <div className="w-full h-2 rounded-full bg-slate-950/90 border border-blue-500/20 overflow-hidden mb-2.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-blue-500 to-purple-500 transition-all duration-500"
                style={{
                  width: `${Math.max(2, Math.min(100, Math.max(agyUtilizationPct, agy.context_bandwidth_pct)))}%`,
                }}
              />
            </div>

            {/* Active Subagent Breakdown: Purple / Blue / Green */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
                  Deep/Argon-Pro: <strong>{agy.active_subagents.heavy}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                  Standard/Flow: <strong>{agy.active_subagents.standard}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-400/15 text-emerald-300 border border-emerald-400/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                  Fast/3.8-Flash: <strong>{agy.active_subagents.light}</strong>
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-cyan-400" />
                Tokens: {fmtCompact(agy.session_tokens)} / {fmtCompact(agy.session_cap)}
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
