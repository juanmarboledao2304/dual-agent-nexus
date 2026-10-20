/**
 * @file DualQuotaHeader.tsx
 * @description Top Dual-Subscription Telemetry Header & 3-Pool Waterfall Status Bar for DualAgent Nexus.
 * Displays side-by-side real-time gauges for the Claude Code Subscription (Warm
 * Spectrum: Crimson Red / Vibrant Orange / Amber Yellow) and the Google Antigravity
 * Subscription (Cool Spectrum: Electric Fuchsia / Neon Indigo / Electric Purple /
 * Cyber Blue / Emerald Green), along with the 3-Pool `agy-cascade` Waterfall
 * Status Bar (`~/.cache/agy-cascade/` 30m cooldown countdown + `===DIGEST===`
 * offloaded token savings), 1-Click Live Multi-Agent Swarm Simulator button, and
 * collapsible Chromatic Thermal Spectrum legend.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useState, useCallback } from "react";
import {
  Play,
  Loader2,
  Activity,
  Palette,
  Clock,
  Layers,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { THERMAL_LEGEND_ITEMS, resolveActivePoolNumber } from "../utils/agentTheme";
import { resolveSpriteVariant } from "../utils/pixelSprites";
import { PixelAvatar } from "./PixelAvatar";
import type { CascadeStatus, DualQuotaTelemetry, WSMessage } from "../lib/types";

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

function fmtCooldownMmSs(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function DualQuotaHeader() {
  const [quota, setQuota] = useState<DualQuotaTelemetry | null>(null);
  const [cascade, setCascade] = useState<CascadeStatus | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const loadQuota = useCallback(async () => {
    try {
      const data = await api.quota.get();
      setQuota(data);
      if (data.cascade) {
        setCascade(data.cascade);
      }
    } catch {
      // Fail-safe: leave previous telemetry in place if server is momentarily unreachable
    }
  }, []);

  useEffect(() => {
    void loadQuota();
    const interval = setInterval(loadQuota, 6000);
    return () => clearInterval(interval);
  }, [loadQuota]);

  // 1-second local countdown tick when any pool is in 30m exhaustion cooldown
  useEffect(() => {
    const claudeEx = cascade?.pools?.claude?.exhausted;
    const geminiEx = cascade?.pools?.gemini?.exhausted;
    if (!claudeEx && !geminiEx) return;

    const timer = setInterval(() => {
      setCascade((prev) => {
        if (!prev) return prev;
        const nextClaudeRem = Math.max(0, (prev.pools.claude.remaining_seconds || 0) - 1);
        const nextGeminiRem = Math.max(0, (prev.pools.gemini.remaining_seconds || 0) - 1);
        return {
          ...prev,
          pools: {
            ...prev.pools,
            claude: {
              ...prev.pools.claude,
              remaining_seconds: nextClaudeRem,
              exhausted: nextClaudeRem > 0,
            },
            gemini: {
              ...prev.pools.gemini,
              remaining_seconds: nextGeminiRem,
              exhausted: nextGeminiRem > 0,
            },
          },
        };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cascade?.pools?.claude?.exhausted, cascade?.pools?.gemini?.exhausted]);

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "quota_updated" && msg.data) {
        const q = msg.data as DualQuotaTelemetry;
        setQuota(q);
        if (q.cascade) setCascade(q.cascade);
      } else if (msg.type === "cascade:status" && msg.data) {
        setCascade(msg.data as CascadeStatus);
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
    setSimMessage("Launching 3-Level agy-cascade Waterfall Swarm...");
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

  const pool1Exhausted = Boolean(cascade?.pools?.claude?.exhausted);
  const pool1Remaining = cascade?.pools?.claude?.remaining_seconds ?? 0;
  const pool2Exhausted = Boolean(cascade?.pools?.gemini?.exhausted);
  const pool2Remaining = cascade?.pools?.gemini?.remaining_seconds ?? 0;
  const activePool = resolveActivePoolNumber(
    cascade?.active_pool,
    pool1Exhausted ? (pool2Exhausted ? 3 : 2) : 1
  );
  const tokensOffloaded = cascade?.tokens_offloaded ?? 0;
  const digestCount = cascade?.digest_count ?? 0;

  const agyUtilizationPct =
    agy.session_cap > 0 ? Math.min(100, (agy.session_tokens / agy.session_cap) * 100) : 0;

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-border bg-surface-1/60 shadow-hairline">
      {/* Waterfall status, simulation controls, and the legend; the telemetry wings follow. */}
      <header className="relative z-10 border-b border-border">
        {/* 3-Pool agy-cascade Waterfall Status Bar */}
        <div
          data-testid="cascade-waterfall-bar"
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px]"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mr-1">
              3-Pool Waterfall
            </span>

            {/* Pool 1: AGY-Claude (Opus 5.5 -> Sonnet 5.5 -> GPT-OSS 120B) */}
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono border transition-all ${
                pool1Exhausted
                  ? "bg-red-500/15 text-red-300 border-red-500/50 animate-pulse"
                  : activePool === 1
                    ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/60"
                    : "bg-slate-950/80 text-slate-400 border-slate-800"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  pool1Exhausted
                    ? "bg-red-500"
                    : activePool === 1
                      ? "bg-fuchsia-400"
                      : "bg-slate-600"
                }`}
              />
              <span>Pool 1: AGY-Claude (Opus 5.5 / Sonnet 5.5 / GPT-OSS)</span>
              {pool1Exhausted && (
                <span className="ml-1 px-1.5 py-0.2 rounded bg-red-950/90 text-red-200 border border-red-500/40 text-[10px] font-bold">
                  EXHAUSTED ({fmtCooldownMmSs(pool1Remaining)})
                </span>
              )}
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />

            {/* Pool 2: AGY-Gemini (Argon -> 3.8 Flash) */}
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono border transition-all ${
                pool2Exhausted
                  ? "bg-red-500/15 text-red-300 border-red-500/50 animate-pulse"
                  : activePool === 2
                    ? "bg-purple-500/25 text-purple-200 border-purple-400/70"
                    : "bg-slate-950/80 text-slate-400 border-slate-800"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  pool2Exhausted
                    ? "bg-red-500"
                    : activePool === 2
                      ? "bg-purple-400"
                      : "bg-slate-600"
                }`}
              />
              <span>Pool 2: AGY-Gemini (Argon 4 / Pro / 3.8 Flash)</span>
              {pool2Exhausted && (
                <span className="ml-1 px-1.5 py-0.2 rounded bg-red-950/90 text-red-200 border border-red-500/40 text-[10px] font-bold">
                  EXHAUSTED ({fmtCooldownMmSs(pool2Remaining)})
                </span>
              )}
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />

            {/* Pool 3: Claude Direct */}
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md font-mono border transition-all ${
                activePool === 3
                  ? "bg-orange-500/25 text-orange-200 border-orange-400/70"
                  : "bg-slate-950/80 text-slate-400 border-slate-800"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  activePool === 3 ? "bg-orange-400" : "bg-slate-600"
                }`}
              />
              <span>Pool 3: Claude Direct (Conductor / Haiku Explore)</span>
            </div>
          </div>

          {/* Right Side: Live Exhaustion Warning Badge + Tokens Offloaded via ===DIGEST=== */}
          <div className="flex flex-wrap items-center gap-2">
            {pool1Exhausted && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/40 font-mono text-[10px] animate-pulse">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                Pool 1 Exhausted (Exit 10) — Cascading to Pool {pool2Exhausted ? "3" : "2"}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 font-mono text-[10px]"
              title="Raw exploration tokens kept out of the Claude Code 5-hour quota window via ===DIGEST=== handoff"
            >
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              Tokens Offloaded via ===DIGEST===:{" "}
              <strong>{fmtCompact(tokensOffloaded)} saved</strong>
              {digestCount > 0 ? ` (${digestCount})` : ""}
            </span>
            {simMessage && (
              <span className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded animate-pulse truncate max-w-xs">
                {simMessage}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowLegend((v) => !v)}
              className="btn-ghost h-7 border border-border px-2.5 py-0 text-[12px]"
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
              className={`btn-ghost h-7 border px-2.5 py-0 text-[12px] ${
                simulating
                  ? "cursor-wait border-amber-400/40 text-amber-200"
                  : "border-border text-gray-200"
              }`}
            >
              {simulating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
              ) : (
                <Play className="w-3.5 h-3.5 text-accent" />
              )}
              <span>{simulating ? "Simulation Running (25s)" : "Run Swarm Simulation"}</span>
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
          <div className="px-5 py-3 bg-slate-900/95 border-b border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2 animate-fade-in">
            {THERMAL_LEGEND_ITEMS.map((item) => (
              <div
                key={`${item.provider}-${item.tier}`}
                className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/80 border border-slate-800/90"
              >
                <PixelAvatar
                  variant={resolveSpriteVariant(item.provider, item.tier)}
                  state="idle"
                  size={24}
                  framed={false}
                  indicator={false}
                  showBadge={false}
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
      </header>

      {/* Dual Telemetry Wings (scroll with the page) */}
      {!collapsed && (
        <section
          aria-label="Dual subscription telemetry"
          className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3"
        >
          {/* LEFT WING: Warm Gradient — Claude Code Subscription */}
          <div className="relative overflow-hidden rounded-xl border border-orange-500/30 bg-gradient-to-br from-red-950/35 via-slate-900/90 to-amber-950/25 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
                  <PixelAvatar
                    variant="claude-opus"
                    state="idle"
                    size={12}
                    framed={false}
                    indicator={false}
                    showBadge={false}
                  />
                  POOL 3 • CLAUDE DIRECT (ANTHROPIC)
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
            <div className="w-full h-1.5 rounded-full bg-slate-950/90 border border-orange-500/20 overflow-hidden mb-2">
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
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Heavy/Opus: <strong>{claude.active_subagents.heavy}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  Standard/Sonnet: <strong>{claude.active_subagents.standard}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-200 border border-amber-400/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
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
          <div className="relative overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-br from-fuchsia-950/30 via-slate-900/90 to-emerald-950/25 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-cyan-300 border border-blue-500/40">
                  <PixelAvatar
                    variant="gemini-argon"
                    state="idle"
                    size={12}
                    framed={false}
                    indicator={false}
                    showBadge={false}
                  />
                  POOL 1 + POOL 2 • ANTIGRAVITY (GOOGLE)
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
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-blue-500 to-fuchsia-500 transition-all duration-500"
                style={{
                  width: `${Math.max(2, Math.min(100, Math.max(agyUtilizationPct, agy.context_bandwidth_pct)))}%`,
                }}
              />
            </div>

            {/* Active Subagent Breakdown: Fuchsia/Purple / Indigo/Blue / Green */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  Deep/Opus-Argon: <strong>{agy.active_subagents.heavy}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Standard/Sonnet-Flow: <strong>{agy.active_subagents.standard}</strong>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-400/15 text-emerald-300 border border-emerald-400/35 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Fast/3.8-Flash: <strong>{agy.active_subagents.light}</strong>
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-cyan-400" />
                Tokens: {fmtCompact(agy.session_tokens)} / {fmtCompact(agy.session_cap)}
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
