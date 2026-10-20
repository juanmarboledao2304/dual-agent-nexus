/**
 * @file SystemHealth.tsx
 * @description System health view (Settings > System health): database, server, hook, and cache
 * health, plus workflow-derived figures, built from `/api/settings/info` and `/api/workflows`. Moved out
 * of the former Dashboard page, where it was the hidden "Health" tab.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Bot,
  Zap,
  Activity,
  GitBranch,
  Server,
  HardDrive,
  Plug,
  Cpu,
  BarChart3,
  ShieldCheck,
  Database,
  Search,
} from "lucide-react";
import { api } from "../lib/api";
import { useDataScope } from "../lib/dataScope";
import { Tip } from "../components/Tip";
import { formatModelName } from "../lib/format";
import type { WorkflowData } from "../lib/types";

/** Tab keys in render order — also the order `1`/`2` and `[`/`]` address them. */

/**
 * Response of `/api/settings/info` as used by the Health tab, which reads more of it than Settings
 * does: SQLite pragmas and load, process memory and CPU, and transcript-cache statistics.
 */
interface SystemInfo {
  /**
   * Database file path and size, row counts per table, the SQLite pragmas in effect (journal mode,
   * synchronous level, auto-vacuum, encoding, foreign keys, busy timeout), and the server's load
   * averages over 5 minutes, 15 minutes, and 1 hour.
   */
  db: {
    path: string;
    size: number;
    counts: Record<string, number>;
    pragmas: {
      journal_mode: string;
      synchronous: number;
      auto_vacuum: number;
      encoding: string;
      foreign_keys: number;
      busy_timeout: number;
    };
    load_stats: { m5: number; m15: number; h1: number };
  };
  /** Claude Code hook installation status. */
  hooks: { installed: boolean; path: string; hooks: Record<string, boolean> };
  /**
   * Server process and host details: uptime, Node.js version, platform and architecture, open
   * WebSocket connections, process memory, CPU load averages, total and free host memory, and CPU
   * count.
   */
  server: {
    uptime: number;
    node_version: string;
    platform: string;
    ws_connections: number;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
    cpu_load: number[];
    arch: string;
    total_mem: number;
    free_mem: number;
    cpus: number;
  };
  /**
   * Transcript parse cache: current and maximum entries, hit and miss counts, and the cached keys.
   */
  transcript_cache: {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    keys: string[];
  };
}

/**
 * Human-readable size in B, KB, or MB.
 *
 * @param bytes - Size in bytes.
 * @returns The formatted size.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compact uptime, for example `3d 4h 12m`, `5h 2m`, or `17m`.
 *
 * @param seconds - Uptime in seconds.
 * @returns The formatted duration.
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Health tab of the Dashboard: database, server, hook, and cache health, plus workflow-derived
 * figures, built from `/api/settings/info` and `/api/workflows`. Refreshed every 30 seconds and
 * when the data scope changes.
 */
export function SystemHealthTab() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [scope] = useDataScope();

  /**
   * Fetch system info and workflow data together for the Health tab. Errors are logged and leave
   * the previous figures on screen.
   */
  const loadData = useCallback(async () => {
    try {
      const [infoRes, workflowRes] = await Promise.all([api.settings.info(), api.workflows.get()]);
      setInfo(infoRes as any);
      setWorkflow(workflowRes);
    } catch (e) {
      console.error(e);
    }
  }, [scope]);

  useEffect(() => {
    loadData();
    const int = setInterval(loadData, 30000); // 30s is sufficient for health metrics
    return () => clearInterval(int);
  }, [loadData]);

  /**
   * Derived figures for the Health tab, such as the share of sessions, agents, and events among
   * stored rows. Null until both requests have loaded.
   */
  const stats = useMemo(() => {
    if (!info || !workflow) return null;

    const totalEntries =
      (info.db.counts?.sessions || 0) +
      (info.db.counts?.agents || 0) +
      (info.db.counts?.events || 0);
    const sessPct = totalEntries > 0 ? ((info.db.counts?.sessions || 0) / totalEntries) * 100 : 0;
    const agentPct = totalEntries > 0 ? ((info.db.counts?.agents || 0) / totalEntries) * 100 : 0;
    const eventPct = totalEntries > 0 ? ((info.db.counts?.events || 0) / totalEntries) * 100 : 0;

    const modelStats = (workflow.modelDelegation?.tokensByModel || [])
      .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens))
      .slice(0, 6);
    const totalTokens = modelStats.reduce((sum, m) => sum + m.input_tokens + m.output_tokens, 0);

    const memUsedPct =
      info.server.total_mem > 0 ? (1 - info.server.free_mem / info.server.total_mem) * 100 : 0;
    const heapUsedPct =
      info.server.memory.heapTotal > 0
        ? (info.server.memory.heapUsed / info.server.memory.heapTotal) * 100
        : 0;

    return {
      totalEntries,
      sessPct,
      agentPct,
      eventPct,
      modelStats,
      totalTokens,
      memUsedPct,
      heapUsedPct,
    };
  }, [info, workflow]);

  if (!info || !workflow || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="animate-pulse h-48 bg-surface-2 rounded-2xl" />
        ))}
      </div>
    );
  }

  const {
    totalEntries,
    sessPct,
    agentPct,
    eventPct,
    modelStats,
    totalTokens,
    memUsedPct,
    heapUsedPct,
  } = stats;
  const successRate = Math.max(0, Math.min(100, workflow.stats.successRate));
  const errorRate = Math.max(
    0,
    Math.min(100, workflow.errorPropagation?.errorRate ?? 100 - successRate)
  );
  const cacheHitRate = Math.max(
    0,
    Math.min(
      100,
      ((info.transcript_cache?.hits ?? 0) /
        ((info.transcript_cache?.hits ?? 0) + (info.transcript_cache?.misses ?? 0) || 1)) *
        100
    )
  );

  // Concurrency histogram data
  const lanes = workflow.concurrency?.aggregateLanes || [];
  const maxLaneCount = Math.max(...lanes.map((l) => l.count), 1);

  // Tool flow top tools
  const topTools = (workflow.toolFlow?.toolCounts || []).slice(0, 8);
  const maxToolCount = topTools.length > 0 ? (topTools[0]?.count ?? 1) : 1;

  // Subagent effectiveness
  const effectiveness = (workflow.effectiveness || []).slice(0, 6);

  // Composite health score - clamped to [0, 100] for display safety
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      successRate * 0.4 +
        cacheHitRate * 0.25 +
        Math.max(0, 100 - errorRate) * 0.25 +
        Math.max(0, 100 - Math.min(100, heapUsedPct)) * 0.1
    )
  );

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Row 1: Runtime + Storage + Health Score */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Runtime Environment */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-gray-500">Runtime</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">
              {info.server.cpus} cores · {info.server.arch}
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Uptime</span>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatUptime(info.server.uptime)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">CPU (1/5/15m)</span>
              <div className="flex gap-1 ml-auto">
                {(info.server.cpu_load || []).slice(0, 3).map((load, i) => (
                  <span
                    key={i}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${i === 0 && load > info.server.cpus ? "bg-red-500/20 text-red-400" : "bg-surface-3 text-gray-300"}`}
                  >
                    {load.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28 flex-shrink-0">Node RSS</span>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatBytes(info.server.memory.rss)}
              </span>
            </div>
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <Tip
              block
              raw={`Host Memory: ${memUsedPct.toFixed(1)}% used\n${formatBytes(info.server.total_mem - info.server.free_mem)} / ${formatBytes(info.server.total_mem)}`}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Host Memory</span>
                  <span className="text-gray-400 font-mono">{memUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${memUsedPct > 90 ? "bg-red-500" : memUsedPct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${memUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
            <Tip
              block
              raw={`V8 Heap: ${heapUsedPct.toFixed(1)}% used\n${formatBytes(info.server.memory.heapUsed)} / ${formatBytes(info.server.memory.heapTotal)}\nExternal: ${formatBytes(info.server.memory.external)}`}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">V8 Heap</span>
                  <span className="text-gray-400 font-mono">{heapUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${heapUsedPct > 85 ? "bg-red-500" : heapUsedPct > 60 ? "bg-amber-500" : "bg-blue-500"}`}
                    style={{ width: `${heapUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
          </div>
        </div>

        {/* Storage Engine */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-gray-500">Storage</span>
            </div>
            <Tip
              raw={`Write velocity (events):\n5 min: ${info.db.load_stats?.m5 ?? 0}\n15 min: ${info.db.load_stats?.m15 ?? 0}\n1 hr: ${info.db.load_stats?.h1 ?? 0}`}
            >
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10 cursor-default">
                LOAD {info.db.load_stats?.m5 ?? 0}/{info.db.load_stats?.m15 ?? 0}/
                {info.db.load_stats?.h1 ?? 0}
              </span>
            </Tip>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 w-28 flex-shrink-0">Database</span>
            <span className="text-xs text-gray-200 font-mono ml-auto">
              {formatBytes(info.db.size)} · {info.db.pragmas?.journal_mode?.toUpperCase() || "WAL"}
            </span>
          </div>

          {/* Pie chart + legend using same pattern as Analytics DonutChart */}
          <div className="flex items-center justify-center gap-5 flex-1">
            <Tip
              raw={`Record Distribution\n\nSessions: ${(info.db.counts?.sessions ?? 0).toLocaleString()} (${sessPct.toFixed(1)}%)\nAgents: ${(info.db.counts?.agents ?? 0).toLocaleString()} (${agentPct.toFixed(1)}%)\nEvents: ${(info.db.counts?.events ?? 0).toLocaleString()} (${eventPct.toFixed(1)}%)\n\nTotal: ${totalEntries.toLocaleString()} records`}
            >
              <svg
                width={96}
                height={96}
                viewBox="0 0 96 96"
                className="flex-shrink-0 cursor-default"
              >
                <circle cx="48" cy="48" r="38" fill="none" stroke="#1e1e2e" strokeWidth="14" />
                {(() => {
                  const r = 38,
                    cx = 48,
                    cy = 48,
                    circumference = 2 * Math.PI * r;
                  const segments = [
                    { pct: sessPct, color: "#60a5fa" },
                    { pct: agentPct, color: "#8b5cf6" },
                    { pct: eventPct, color: "#34d399" },
                  ];
                  let offset = circumference / 4;
                  return segments.map((seg, i) => {
                    if (seg.pct <= 0) return null;
                    const dash = (seg.pct / 100) * circumference;
                    const gap = circumference - dash;
                    const currentOffset = offset;
                    offset -= dash;
                    return (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="14"
                        strokeDasharray={`${dash} ${gap}`}
                        strokeDashoffset={currentOffset}
                      />
                    );
                  });
                })()}
                <text
                  x="48"
                  y="46"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-300"
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {totalEntries > 999 ? `${(totalEntries / 1000).toFixed(1)}K` : totalEntries}
                </text>
                <text
                  x="48"
                  y="60"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="8"
                >
                  total
                </text>
              </svg>
            </Tip>
            <div className="space-y-2.5">
              {[
                {
                  label: "Sessions",
                  value: info.db.counts?.sessions ?? 0,
                  color: "#60a5fa",
                  pct: sessPct,
                },
                {
                  label: "Agents",
                  value: info.db.counts?.agents ?? 0,
                  color: "#8b5cf6",
                  pct: agentPct,
                },
                {
                  label: "Events",
                  value: info.db.counts?.events ?? 0,
                  color: "#34d399",
                  pct: eventPct,
                },
              ].map((item) => (
                <Tip
                  block
                  key={item.label}
                  raw={`${item.label}: ${item.value.toLocaleString()} (${item.pct.toFixed(1)}%)`}
                >
                  <div className="flex items-center gap-2 text-xs cursor-default">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-gray-500 ml-auto pl-3 font-mono">
                      {Math.round(item.pct)}%
                    </span>
                  </div>
                </Tip>
              ))}
            </div>
          </div>
        </div>

        {/* Health Score */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-gray-500">Health Score</span>
            </div>
            <Tip
              raw={`Composite Index formula:\n0.4 × Success Rate (${successRate.toFixed(1)}%)\n+ 0.25 × Cache Hit (${cacheHitRate.toFixed(1)}%)\n+ 0.25 × (100 − Error Rate) (${(100 - errorRate).toFixed(1)}%)\n+ 0.10 × (100 − Heap%) (${(100 - heapUsedPct).toFixed(1)}%)\n= ${healthScore.toFixed(1)}`}
            >
              <span className="text-[10px] text-gray-500 cursor-help border-b border-dashed border-gray-700">
                ⓘ Formula
              </span>
            </Tip>
          </div>

          {/* Ring gauge - centered */}
          <div className="flex items-center justify-center flex-1">
            <Tip
              raw={`Score: ${healthScore.toFixed(1)} / 100\n\n• Success Rate (40%): ${successRate.toFixed(1)}%\n• Cache Hit (25%): ${cacheHitRate.toFixed(1)}%\n• Error Avoidance (25%): ${(100 - errorRate).toFixed(1)}%\n• Memory Health (10%): ${(100 - heapUsedPct).toFixed(1)}%`}
            >
              <svg width="120" height="120" viewBox="0 0 120 120" className="cursor-default">
                <circle cx="60" cy="60" r="48" fill="none" stroke="#1e1e2e" strokeWidth="10" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={healthScore >= 90 ? "#34d399" : healthScore >= 70 ? "#fbbf24" : "#f87171"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${healthScore * 3.016} ${301.6 - healthScore * 3.016}`}
                  strokeDashoffset={301.6 / 4}
                  className="transition-all duration-1000"
                />
                <text
                  x="60"
                  y="57"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-100"
                  fontSize="24"
                  fontWeight="800"
                  fontFamily="monospace"
                >
                  {healthScore.toFixed(0)}
                </text>
                <text
                  x="60"
                  y="76"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="9"
                  fontWeight="500"
                >
                  / 100
                </text>
              </svg>
            </Tip>
          </div>

          {/* Sub-metrics row */}
          <div className="grid grid-cols-4 gap-2 border-t border-border/40 pt-3">
            <Tip
              block
              raw={`Cache Hit Rate: ${cacheHitRate.toFixed(1)}%\nHits: ${info.transcript_cache?.hits ?? 0}\nMisses: ${info.transcript_cache?.misses ?? 0}`}
            >
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Cache</p>
                <p className="text-xs font-mono font-bold text-blue-400">
                  {cacheHitRate.toFixed(0)}%
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Error Rate: ${errorRate.toFixed(2)}%\n<5% = healthy, 5-15% = warning, >15% = critical`}
            >
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Errors</p>
                <p
                  className={`text-xs font-mono font-bold ${errorRate < 5 ? "text-emerald-400" : errorRate < 15 ? "text-amber-400" : "text-red-400"}`}
                >
                  {errorRate.toFixed(1)}%
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Transcript compactions: ${workflow.compaction?.totalCompactions ?? 0}\nReduces context window by summarizing turns.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Compact</p>
                <p className="text-xs font-mono font-bold text-violet-400">
                  {workflow.compaction?.totalCompactions ?? 0}
                </p>
              </div>
            </Tip>
            <Tip
              block
              raw={`Tokens recovered: ${(workflow.compaction?.tokensRecovered ?? 0).toLocaleString()}\nFreed by compaction.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Saved</p>
                <p className="text-xs font-mono font-bold text-emerald-400">
                  {((workflow.compaction?.tokensRecovered ?? 0) / 1000).toFixed(1)}K
                </p>
              </div>
            </Tip>
          </div>
        </div>
      </div>

      {/* Row 2: Model Usage + Concurrency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Token Distribution */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-gray-500">Token Usage</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">
              {(totalTokens / 1000).toFixed(1)}K total
            </span>
          </div>

          <div className="space-y-2.5">
            {modelStats.map((m, i) => {
              const pct =
                totalTokens > 0 ? ((m.input_tokens + m.output_tokens) / totalTokens) * 100 : 0;
              const colors = [
                "bg-blue-400",
                "bg-violet-400",
                "bg-emerald-400",
                "bg-amber-400",
                "bg-pink-400",
                "bg-cyan-400",
              ];
              return (
                <Tip
                  block
                  key={i}
                  raw={`${formatModelName(m.model) ?? m.model}\nInput: ${m.input_tokens.toLocaleString()}\nOutput: ${m.output_tokens.toLocaleString()}\nCache Read: ${m.cache_read_tokens.toLocaleString()}\nShare: ${pct.toFixed(1)}%`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span
                      className="text-xs text-gray-400 w-28 truncate flex-shrink-0"
                      title={formatModelName(m.model) ?? m.model}
                    >
                      {formatModelName(m.model) ?? m.model}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${colors[i % colors.length]} h-2 rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0 font-mono">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </Tip>
              );
            })}
            {modelStats.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">No model data</p>
            )}
          </div>
        </div>

        {/* Concurrency Timeline */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-gray-500">Concurrency</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">{lanes.length} intervals</span>
          </div>

          {/* Sparkline-style bar chart matching Analytics sparkline */}
          <Tip
            block
            raw={`Peak: ${maxLaneCount} parallel sessions\nActive intervals: ${lanes.filter((l) => l.count > 0).length}\nAvg: ${lanes.length > 0 ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1) : "0"}`}
          >
            <div className="flex items-end gap-px h-20 cursor-default">
              {lanes.slice(-Math.min(lanes.length, 40)).map((lane, i) => {
                const barPct =
                  maxLaneCount > 0 ? Math.max(4, Math.round((lane.count / maxLaneCount) * 100)) : 4;
                const color =
                  lane.count > 5
                    ? "#f87171"
                    : lane.count > 2
                      ? "#fbbf24"
                      : lane.count > 0
                        ? "#34d399"
                        : "#1e1e2e";
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all"
                    style={{
                      height: `${barPct}%`,
                      backgroundColor: color,
                      opacity: lane.count === 0 ? 0.2 : 0.85,
                    }}
                  />
                );
              })}
              {lanes.length === 0 && (
                <p className="text-xs text-gray-600 text-center w-full self-center">
                  No concurrency data
                </p>
              )}
            </div>
          </Tip>

          <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
            <Tip block raw={`Peak: ${maxLaneCount} sessions running simultaneously.`}>
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Peak</p>
                <p className="text-sm font-mono font-bold text-gray-200">{maxLaneCount}</p>
              </div>
            </Tip>
            <Tip
              block
              raw={`${lanes.filter((l) => l.count > 0).length} of ${lanes.length} intervals have active sessions.`}
            >
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Active</p>
                <p className="text-sm font-mono font-bold text-emerald-400">
                  {lanes.filter((l) => l.count > 0).length}
                </p>
              </div>
            </Tip>
            <Tip block raw={`Average concurrency across all intervals.`}>
              <div className="text-center cursor-default">
                <p className="text-[11px] text-gray-600">Avg</p>
                <p className="text-sm font-mono font-bold text-blue-400">
                  {lanes.length > 0
                    ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1)
                    : "0"}
                </p>
              </div>
            </Tip>
          </div>
        </div>
      </div>

      {/* Row 3: Tool Usage + Subagent Effectiveness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tool Invocations */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-gray-500">Tool Usage</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">top {topTools.length}</span>
          </div>

          <div className="space-y-2">
            {topTools.map((tool, i) => {
              const pct = maxToolCount > 0 ? Math.round((tool.count / maxToolCount) * 100) : 0;
              const colors = [
                "bg-amber-400",
                "bg-blue-400",
                "bg-emerald-400",
                "bg-violet-400",
                "bg-pink-400",
                "bg-cyan-400",
                "bg-red-400",
                "bg-indigo-400",
              ];
              return (
                <Tip
                  block
                  key={i}
                  raw={`${tool.tool_name}: ${tool.count.toLocaleString()} invocations`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span
                      className="text-xs text-gray-400 w-28 truncate flex-shrink-0"
                      title={tool.tool_name}
                    >
                      {tool.tool_name}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${colors[i % colors.length]} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0 font-mono">
                      {tool.count > 999 ? `${(tool.count / 1000).toFixed(1)}K` : tool.count}
                    </span>
                  </div>
                </Tip>
              );
            })}
            {topTools.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">No tool data yet</p>
            )}
          </div>
        </div>

        {/* Subagent Effectiveness */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GitBranch className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-gray-500">Subagent Effectiveness</span>
            </div>
          </div>

          <div className="space-y-2">
            {effectiveness.map((item, i) => {
              const color =
                item.successRate >= 90
                  ? "bg-emerald-400"
                  : item.successRate >= 70
                    ? "bg-amber-400"
                    : "bg-red-400";
              return (
                <Tip
                  block
                  key={i}
                  raw={`${item.subagent_type || "default"}\nSuccess: ${item.successRate.toFixed(1)}%\nTotal: ${item.total} · OK: ${item.completed} · Errors: ${item.errors}`}
                >
                  <div className="flex items-center gap-3 cursor-default">
                    <span className="text-xs text-gray-400 w-28 truncate flex-shrink-0">
                      {item.subagent_type || "default"}
                    </span>
                    <div className="flex-1 bg-surface-3 rounded-full h-2">
                      <div
                        className={`${color} h-2 rounded-full transition-all duration-500`}
                        style={{ width: `${item.successRate}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs w-12 text-right flex-shrink-0 font-mono ${item.successRate >= 90 ? "text-emerald-400" : item.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}
                    >
                      {item.successRate.toFixed(0)}%
                    </span>
                  </div>
                </Tip>
              );
            })}
            {effectiveness.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">No subagent data yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Row 4: Integration Gateway + Platform Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Integration Gateway */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plug className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-gray-500">Integration</span>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${info.hooks.installed ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-surface-3 text-gray-500 border border-border"}`}
            >
              {info.hooks.installed ? "Active" : "Offline"}
            </span>
          </div>

          {Object.entries(info.hooks.hooks || {}).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(info.hooks.hooks).map(([cwd, active]) => (
                <Tip
                  block
                  key={cwd}
                  raw={`Path: ${cwd}\nStatus: ${active ? "Connected" : "Disconnected"}`}
                >
                  <div className="flex items-center gap-3 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-emerald-400" : "bg-gray-600"}`}
                    />
                    <span className="text-xs text-gray-300 truncate font-mono">
                      {cwd.split("/").pop() || cwd}
                    </span>
                  </div>
                </Tip>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border border-dashed border-border/40 rounded-lg">
              <Search className="w-4 h-4 text-gray-600 mb-2" />
              <p className="text-xs text-gray-500">No project hooks registered</p>
            </div>
          )}

          <Tip
            block
            raw={`WebSocket connections: ${info.server.ws_connections}\nProtocol: RFC 6455`}
          >
            <div className="flex items-center gap-3 bg-emerald-500/5 px-3 py-2.5 rounded-lg border border-emerald-500/10 cursor-default">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <div>
                <p className="text-[10px] text-emerald-400 font-medium">WebSocket Active</p>
                <p className="text-[10px] text-gray-500">
                  {info.server.ws_connections} connection
                  {info.server.ws_connections !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </Tip>
        </div>

        {/* Platform Config */}
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-gray-500">Platform</span>
            </div>
            <span className="text-[10px] font-mono text-gray-500">{info.server.node_version}</span>
          </div>

          <div className="space-y-2">
            {[
              {
                label: "Journal Mode",
                value: info.db.pragmas?.journal_mode?.toUpperCase() || "WAL",
              },
              {
                label: "Synchronous",
                value:
                  info.db.pragmas?.synchronous === 2
                    ? "FULL"
                    : info.db.pragmas?.synchronous === 1
                      ? "NORMAL"
                      : "OFF",
              },
              { label: "Auto-Vacuum", value: info.db.pragmas?.auto_vacuum > 0 ? "FULL" : "OFF" },
              { label: "Foreign Keys", value: info.db.pragmas?.foreign_keys ? "ON" : "OFF" },
              { label: "Busy Timeout", value: `${info.db.pragmas?.busy_timeout || 5000}ms` },
              { label: "Platform", value: `${info.server.platform} / ${info.server.arch}` },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-28 flex-shrink-0">{row.label}</span>
                <span className="text-xs text-gray-200 font-mono ml-auto">{row.value}</span>
              </div>
            ))}
          </div>

          <Tip block raw={info.db.path}>
            <div className="flex items-center gap-2 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
              <HardDrive className="w-3 h-3 text-gray-500 flex-shrink-0" />
              <span className="text-[10px] text-gray-400 font-mono truncate">{info.db.path}</span>
            </div>
          </Tip>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard page (`/`). The Monitor tab shows overview stat cards, live agent cards with
 * collapsible subagent trees, and a recent activity feed whose item counts adapt to the available
 * height. The Health tab is {@link SystemHealthTab}. The tab is mirrored in the URL. Data follows
 * the global data scope, reloads on live WebSocket updates (throttled to at most one load every 2
 * seconds), and is polled every 10 seconds as a backstop.
 */
