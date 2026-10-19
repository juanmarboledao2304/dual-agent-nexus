/**
 * @file SubagentGraph.tsx
 * @description 3-Level Waterfall Subagent Hierarchy Graph Visualizer for DualAgent Nexus.
 * Renders:
 * - Level 1 (Left Column): Top-level Orchestrator / Conductor nodes (Claude Opus/Sonnet in Warm Red/Orange;
 *   Google Antigravity Argon/Pro/Flow in Cool Purple/Blue)
 * - Level 2 (Middle Column): Spawned Subagents & Cross-CLI `agy-cascade` / `agy-delegate` Bridge Nodes
 *   (Electric Fuchsia / Neon Indigo for AGY-Claude pool; Cool Purple/Blue for AGY-Gemini pool; Warm Amber for Haiku)
 * - Level 3 (Right Branching Column): Internal `agy` Fan-Out Specialist Subagents (`invoke_subagent` with
 *   `conversationId`, `===DIGEST===` handoff badges, and `Git Checkpoints: N` verification badges).
 * Connected via animated SVG bezier curves (`stroke-dasharray` pulse in the child's thermal color).
 * Clicking any node opens the AgentInspectorDrawer.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useMemo, useState } from "react";
import {
  GitBranch,
  Flame,
  Sparkles,
  Wrench,
  OctagonX,
  Maximize2,
  Minimize2,
  ShieldCheck,
  GitCommit,
} from "lucide-react";
import {
  getAgentThermalTheme,
  formatAgentModelBadge,
  parseAgentMetadata,
} from "../utils/agentTheme";
import { api } from "../lib/api";
import type { Agent, Session } from "../lib/types";

interface SubagentGraphProps {
  agents: Agent[];
  subagents: Agent[];
  sessionsById: Map<string, Session>;
  onSelectAgent: (agent: Agent) => void;
  onRefresh?: () => void;
}

interface Level2Branch {
  node: Agent;
  level3Children: Agent[];
}

interface HierarchyTree {
  root: Agent;
  session?: Session;
  children: Agent[];
  level2Branches: Level2Branch[];
  totalDescendants: number;
}

export function SubagentGraph({
  agents,
  subagents,
  sessionsById,
  onSelectAgent,
  onRefresh,
}: SubagentGraphProps) {
  const [expandedView, setExpandedView] = useState(false);
  const [killingId, setKillingId] = useState<string | null>(null);

  const trees = useMemo<HierarchyTree[]>(() => {
    const allById = new Map<string, Agent>();
    for (const a of agents) allById.set(a.id, a);
    for (const s of subagents) allById.set(s.id, s);

    const mains = Array.from(allById.values()).filter((a) => a.type === "main");
    const subs = Array.from(allById.values()).filter((a) => a.type === "subagent");

    const bySession = new Map<string, Agent[]>();
    const byParent = new Map<string, Agent[]>();

    for (const sub of subs) {
      if (sub.parent_agent_id) {
        const list = byParent.get(sub.parent_agent_id) || [];
        list.push(sub);
        byParent.set(sub.parent_agent_id, list);
      }
      const sList = bySession.get(sub.session_id) || [];
      sList.push(sub);
      bySession.set(sub.session_id, sList);
    }

    const result: HierarchyTree[] = [];
    for (const main of mains) {
      const sessionKids = bySession.get(main.session_id) || [];
      const directKids = byParent.get(main.id) || [];
      const allSessionSubMap = new Map<string, Agent>();
      for (const k of [...directKids, ...sessionKids]) {
        if (k.id !== main.id) allSessionSubMap.set(k.id, k);
      }
      const allSessionSubs = Array.from(allSessionSubMap.values());
      const subIdSet = new Set(allSessionSubs.map((s) => s.id));

      // Level-2 nodes are subagents whose parent is main (or null/not another subagent in this session)
      const level2Nodes = allSessionSubs.filter(
        (s) =>
          !s.parent_agent_id || s.parent_agent_id === main.id || !subIdSet.has(s.parent_agent_id)
      );

      const level2Branches: Level2Branch[] = level2Nodes.map((l2) => {
        const l3Kids = allSessionSubs.filter((s) => s.parent_agent_id === l2.id);
        return {
          node: l2,
          level3Children: l3Kids,
        };
      });

      result.push({
        root: main,
        session: sessionsById.get(main.session_id),
        children: allSessionSubs,
        level2Branches,
        totalDescendants: allSessionSubs.length,
      });
    }

    // Sort trees with 3-level fan-out, children, or working status first
    result.sort((a, b) => {
      const aHasL3 = a.level2Branches.some((b2) => b2.level3Children.length > 0) ? 15 : 0;
      const bHasL3 = b.level2Branches.some((b2) => b2.level3Children.length > 0) ? 15 : 0;
      const aScore =
        aHasL3 + (a.children.length > 0 ? 10 : 0) + (a.root.status === "working" ? 5 : 0);
      const bScore =
        bHasL3 + (b.children.length > 0 ? 10 : 0) + (b.root.status === "working" ? 5 : 0);
      return bScore - aScore;
    });

    return result.filter((t) => t.children.length > 0).slice(0, expandedView ? 12 : 6);
  }, [agents, subagents, sessionsById, expandedView]);

  const handleKill = async (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    if (killingId) return;
    setKillingId(agentId);
    try {
      await api.agents.kill(agentId);
      onRefresh?.();
    } catch {
      // Ignore error
    } finally {
      setKillingId(null);
    }
  };

  if (trees.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-slate-800/90 bg-slate-950/90 p-5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/20 via-fuchsia-500/20 to-purple-500/20 border border-slate-700 flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 tracking-wide">
                Live 3-Level Waterfall Hierarchy &amp; Thermal Topology
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-300 border border-slate-800">
                {trees.length} orchestrator{trees.length === 1 ? "" : "s"} ·{" "}
                {trees.reduce((acc, t) => acc + t.totalDescendants, 0)} subagents
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Level 1 Conductor ➔ Level 2 `agy-cascade` Bridge ➔ Level 3 Internal `agy` Fan-Out
              Specialists (`===DIGEST===` &amp; Git Checkpoints).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {trees.length > 2 && (
            <button
              type="button"
              onClick={() => setExpandedView((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors"
            >
              {expandedView ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" /> Compact
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" /> Expand All
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {trees.map(({ root, session, level2Branches }) => {
          const rootTheme = getAgentThermalTheme(root, session?.provider, session?.model);
          const rootModel = formatAgentModelBadge(root.model || session?.model, rootTheme.provider);
          const rootMeta = parseAgentMetadata(root.metadata);
          const isRootWorking = root.status === "working" || root.status === "waiting";
          const hasAnyLevel3 = level2Branches.some((b) => b.level3Children.length > 0);
          const totalRows = Math.max(
            level2Branches.length,
            level2Branches.reduce((acc, b) => acc + Math.max(1, b.level3Children.length), 0)
          );
          const svgHeight = Math.max(130, totalRows * 82 + 24);
          const rootY = svgHeight / 2;

          return (
            <div
              key={root.id}
              className={`relative rounded-xl border p-4 bg-slate-900/60 overflow-x-auto ${rootTheme.borderClass} ${
                hasAnyLevel3 ? "xl:col-span-2" : ""
              }`}
            >
              {/* Level 1 Orchestrator -> Animated SVG Bezier Curves -> Level 2 Bridge / Subagents (-> Level 3 Fan-Out) */}
              <div
                className="grid grid-cols-[minmax(195px,235px)_64px_minmax(240px,1fr)] items-center min-w-[540px]"
                style={{ minHeight: `${svgHeight}px` }}
              >
                {/* Left Column: Level 1 Parent Orchestrator Node */}
                <div
                  onClick={() => onSelectAgent(root)}
                  className={`cursor-pointer rounded-xl border-2 p-3 transition-all hover:scale-[1.02] ${rootTheme.borderClass} ${rootTheme.bgGradientClass} ${rootTheme.glowClass}`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${rootTheme.providerPillClass}`}
                    >
                      {rootTheme.provider === "claude" ? (
                        <Flame className="w-2.5 h-2.5" />
                      ) : (
                        <Sparkles className="w-2.5 h-2.5" />
                      )}
                      {rootTheme.providerLabel}
                    </span>
                    {/* 4-Bar Effort Meter */}
                    <span className="flex items-end gap-0.5 h-2.5" title={rootTheme.effortLabel}>
                      {[1, 2, 3, 4].map((b) => (
                        <span
                          key={b}
                          className={`w-1 rounded-sm ${
                            b <= rootTheme.effortBars ? rootTheme.barActiveClass : "bg-slate-700/50"
                          }`}
                          style={{ height: `${b * 25}%` }}
                        />
                      ))}
                    </span>
                  </div>

                  <p className="text-xs font-bold text-slate-100 truncate" title={root.name}>
                    {session?.name || root.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${rootTheme.badgeClass}`}
                    >
                      {rootModel}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {rootTheme.effortLabel}
                    </span>
                  </div>

                  {/* ===DIGEST=== & Git Checkpoints Badges on Root if present */}
                  {(rootMeta.digest_received ||
                    rootMeta.digest ||
                    (rootMeta.git_checkpoints && rootMeta.git_checkpoints > 0)) && (
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      {(rootMeta.digest_received || rootMeta.digest) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          ===DIGEST=== Received
                        </span>
                      )}
                      {rootMeta.git_checkpoints && rootMeta.git_checkpoints > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
                          <GitCommit className="w-2.5 h-2.5" />
                          Git Checkpoints: {rootMeta.git_checkpoints}
                        </span>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1 text-slate-300 truncate">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${rootTheme.dotClass} ${
                          isRootWorking ? "animate-ping" : ""
                        }`}
                      />
                      <span className="truncate font-mono">{root.current_tool || root.status}</span>
                    </span>
                    {isRootWorking && (
                      <button
                        type="button"
                        onClick={(e) => handleKill(e, root.id)}
                        title="Kill Orchestrator (SIGTERM)"
                        className="text-red-400 hover:text-red-300 p-0.5 rounded"
                      >
                        <OctagonX className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Center Column: Animated SVG Bezier Curves (Level 1 -> Level 2) */}
                <svg
                  width="64"
                  height={svgHeight}
                  viewBox={`0 0 64 ${svgHeight}`}
                  className="overflow-visible"
                >
                  {level2Branches.map(({ node: child }, idx) => {
                    const childTheme = getAgentThermalTheme(
                      child,
                      session?.provider,
                      session?.model
                    );
                    const step = svgHeight / (level2Branches.length + 1);
                    const childY = Math.round(step * (idx + 1));
                    const isChildWorking = child.status === "working" || child.status === "waiting";
                    const pathD = `M 2 ${rootY} C 32 ${rootY}, 32 ${childY}, 62 ${childY}`;

                    return (
                      <g key={child.id}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke={childTheme.svgStroke}
                          strokeOpacity={0.28}
                          strokeWidth={2}
                        />
                        <path
                          d={pathD}
                          fill="none"
                          stroke={childTheme.svgStroke}
                          strokeWidth={2.25}
                          strokeDasharray={isChildWorking ? "5 5" : "none"}
                          strokeOpacity={isChildWorking ? 0.95 : 0.55}
                          className={isChildWorking ? "animate-pulse" : ""}
                        />
                        <circle cx={62} cy={childY} r={3} fill={childTheme.svgStroke} />
                      </g>
                    );
                  })}
                  <circle cx={2} cy={rootY} r={3.5} fill={rootTheme.svgStroke} />
                </svg>

                {/* Right Column: Level 2 Nodes + Optional Level 3 Fan-Out Specialist Subtree */}
                <div className="flex flex-col justify-around gap-3 py-1">
                  {level2Branches.map(({ node: child, level3Children }) => {
                    const childTheme = getAgentThermalTheme(
                      child,
                      session?.provider,
                      session?.model
                    );
                    const childModel = formatAgentModelBadge(child.model, childTheme.provider);
                    const childRole = child.subagent_role || child.subagent_type || "Subagent";
                    const childMeta = parseAgentMetadata(child.metadata);
                    const isChildWorking = child.status === "working" || child.status === "waiting";

                    const l3SvgHeight = Math.max(96, level3Children.length * 72 + 12);
                    const l2AnchorY = l3SvgHeight / 2;

                    const level2Card = (
                      <div
                        onClick={() => onSelectAgent(child)}
                        className={`cursor-pointer rounded-xl border p-2.5 transition-all hover:scale-[1.01] ${childTheme.borderClass} ${childTheme.bgGradientClass} ${childTheme.glowClass}`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${childTheme.dotClass} ${
                                isChildWorking ? "animate-pulse" : ""
                              }`}
                            />
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${childTheme.providerPillClass}`}
                            >
                              {childTheme.providerLabel}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${childTheme.badgeClass}`}
                            >
                              {childRole}
                            </span>
                            <span className="text-[10px] font-mono text-slate-200 truncate">
                              {childModel}
                            </span>
                          </div>

                          {/* 4-Bar Effort Signal Meter */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span
                              className="flex items-end gap-0.5 h-2.5"
                              title={`Effort: ${childTheme.effortLabel}`}
                            >
                              {[1, 2, 3, 4].map((b) => (
                                <span
                                  key={b}
                                  className={`w-0.5 rounded-sm ${
                                    b <= childTheme.effortBars
                                      ? childTheme.barActiveClass
                                      : "bg-slate-700/50"
                                  }`}
                                  style={{ height: `${b * 25}%` }}
                                />
                              ))}
                            </span>
                            {isChildWorking && (
                              <button
                                type="button"
                                onClick={(e) => handleKill(e, child.id)}
                                title="Stop Subagent (SIGTERM)"
                                className="text-red-400 hover:text-red-300"
                              >
                                <OctagonX className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        <p
                          className="text-[11px] font-medium text-slate-200 truncate mt-1"
                          title={child.name}
                        >
                          {child.name}
                        </p>
                        {child.task && child.task !== child.name && (
                          <p
                            className="text-[10px] text-slate-400 truncate mt-0.5"
                            title={child.task}
                          >
                            {child.task}
                          </p>
                        )}

                        {/* Waterfall Cascade Event / Digest / Git Checkpoint Pills */}
                        {(childMeta.cascade_exit_code === 10 ||
                          childMeta.digest_received ||
                          childMeta.digest ||
                          (childMeta.git_checkpoints && childMeta.git_checkpoints > 0)) && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {childMeta.cascade_exit_code === 10 && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/40">
                                Exit 10 ➔ Pool 2 Failover
                              </span>
                            )}
                            {(childMeta.digest_received || childMeta.digest) && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                ===DIGEST===
                              </span>
                            )}
                            {childMeta.git_checkpoints && childMeta.git_checkpoints > 0 ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
                                <GitCommit className="w-2.5 h-2.5" />
                                Git Checkpoints: {childMeta.git_checkpoints}
                              </span>
                            ) : null}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                          <span className="flex items-center gap-1 truncate">
                            {child.current_tool ? (
                              <>
                                <Wrench className="w-2.5 h-2.5 text-amber-300" />
                                <span>{child.current_tool}</span>
                              </>
                            ) : (
                              <span>{child.status}</span>
                            )}
                          </span>
                          {child.input_tokens || child.output_tokens ? (
                            <span>
                              {(
                                (child.input_tokens || 0) + (child.output_tokens || 0)
                              ).toLocaleString()}{" "}
                              tok
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );

                    if (level3Children.length === 0) {
                      return <div key={child.id}>{level2Card}</div>;
                    }

                    // 3-Level Waterfall Layout: Level 2 Bridge -> SVG Curves -> Level 3 Fan-Out Specialists
                    return (
                      <div
                        key={child.id}
                        className="grid grid-cols-[minmax(220px,265px)_52px_minmax(220px,1fr)] items-center"
                      >
                        {level2Card}

                        <svg
                          width="52"
                          height={l3SvgHeight}
                          viewBox={`0 0 52 ${l3SvgHeight}`}
                          className="overflow-visible"
                        >
                          {level3Children.map((l3, l3Idx) => {
                            const l3Theme = getAgentThermalTheme(
                              l3,
                              session?.provider,
                              session?.model
                            );
                            const l3Step = l3SvgHeight / (level3Children.length + 1);
                            const l3Y = Math.round(l3Step * (l3Idx + 1));
                            const isL3Working = l3.status === "working" || l3.status === "waiting";
                            const pathD = `M 2 ${l2AnchorY} C 26 ${l2AnchorY}, 26 ${l3Y}, 50 ${l3Y}`;

                            return (
                              <g key={l3.id}>
                                <path
                                  d={pathD}
                                  fill="none"
                                  stroke={l3Theme.svgStroke}
                                  strokeOpacity={0.3}
                                  strokeWidth={1.75}
                                />
                                <path
                                  d={pathD}
                                  fill="none"
                                  stroke={l3Theme.svgStroke}
                                  strokeWidth={2}
                                  strokeDasharray={isL3Working ? "4 4" : "none"}
                                  strokeOpacity={isL3Working ? 0.95 : 0.6}
                                  className={isL3Working ? "animate-pulse" : ""}
                                />
                                <circle cx={50} cy={l3Y} r={2.5} fill={l3Theme.svgStroke} />
                              </g>
                            );
                          })}
                          <circle cx={2} cy={l2AnchorY} r={3} fill={childTheme.svgStroke} />
                        </svg>

                        {/* Level 3 Specialist Fan-Out Subagents */}
                        <div className="flex flex-col justify-around gap-2 py-0.5">
                          {level3Children.map((l3) => {
                            const l3Theme = getAgentThermalTheme(
                              l3,
                              session?.provider,
                              session?.model
                            );
                            const l3Model = formatAgentModelBadge(l3.model, l3Theme.provider);
                            const l3Meta = parseAgentMetadata(l3.metadata);
                            const isL3Working = l3.status === "working" || l3.status === "waiting";

                            return (
                              <div
                                key={l3.id}
                                onClick={() => onSelectAgent(l3)}
                                className={`cursor-pointer rounded-xl border p-2 transition-all hover:scale-[1.01] ${l3Theme.borderClass} ${l3Theme.bgGradientClass} ${l3Theme.glowClass}`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1 min-w-0">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${l3Theme.dotClass} ${
                                        isL3Working ? "animate-ping" : ""
                                      }`}
                                    />
                                    <span
                                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${l3Theme.badgeClass}`}
                                    >
                                      L3 Fan-Out
                                    </span>
                                    <span className="text-[10px] font-semibold text-slate-100 truncate">
                                      {l3.name}
                                    </span>
                                  </div>
                                  <span className="text-[9px] font-mono text-slate-300 flex-shrink-0">
                                    {l3Model}
                                  </span>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-1 mt-1 text-[9px] font-mono text-slate-400">
                                  <span className="truncate">
                                    {l3Meta.conversation_id
                                      ? `conv:${l3Meta.conversation_id.slice(0, 12)}`
                                      : l3.current_tool || l3.status}
                                  </span>
                                  {l3Meta.git_checkpoints && l3Meta.git_checkpoints > 0 ? (
                                    <span className="inline-flex items-center gap-0.5 text-cyan-300">
                                      <GitCommit className="w-2.5 h-2.5" />
                                      {l3Meta.git_checkpoints}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
