/**
 * @file SubagentGraph.tsx
 * @description Live Subagent Hierarchy Graph Visualizer for DualAgent Nexus.
 * Renders parent orchestrator nodes (Claude Opus/Sonnet in Warm Red/Orange;
 * Google Antigravity Argon/Pro/Flow in Cool Purple/Blue) connected via animated
 * SVG bezier curves (`stroke-dasharray` pulse in the child's thermal color) to
 * their spawned child subagents (Haiku in Amber Yellow, Gemini 3.8 Flash in
 * Emerald Green). Clicking any node opens the AgentInspectorDrawer.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useMemo, useState } from "react";
import { GitBranch, Flame, Sparkles, Wrench, OctagonX, Maximize2, Minimize2 } from "lucide-react";
import { getAgentThermalTheme, formatAgentModelBadge } from "../utils/agentTheme";
import { api } from "../lib/api";
import type { Agent, Session } from "../lib/types";

interface SubagentGraphProps {
  agents: Agent[];
  subagents: Agent[];
  sessionsById: Map<string, Session>;
  onSelectAgent: (agent: Agent) => void;
  onRefresh?: () => void;
}

interface HierarchyTree {
  root: Agent;
  session?: Session;
  children: Agent[];
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
      const directKids = byParent.get(main.id) || [];
      const sessionKids = bySession.get(main.session_id) || [];
      const mergedMap = new Map<string, Agent>();
      for (const k of [...directKids, ...sessionKids]) {
        if (k.id !== main.id) mergedMap.set(k.id, k);
      }
      result.push({
        root: main,
        session: sessionsById.get(main.session_id),
        children: Array.from(mergedMap.values()),
      });
    }

    // Sort trees with children or working status first
    result.sort((a, b) => {
      const aScore = (a.children.length > 0 ? 10 : 0) + (a.root.status === "working" ? 5 : 0);
      const bScore = (b.children.length > 0 ? 10 : 0) + (b.root.status === "working" ? 5 : 0);
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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/20 to-purple-500/20 border border-slate-700 flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 tracking-wide">
                Live Subagent Hierarchy &amp; Thermal Topology
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-300 border border-slate-800">
                {trees.length} orchestrator{trees.length === 1 ? "" : "s"} ·{" "}
                {trees.reduce((acc, t) => acc + t.children.length, 0)} subagents
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Click any orchestrator or spawned subagent node to inspect its prompt, live tool
              trace, or send SIGTERM.
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
        {trees.map(({ root, session, children }) => {
          const rootTheme = getAgentThermalTheme(root, session?.provider, session?.model);
          const rootModel = formatAgentModelBadge(root.model || session?.model, rootTheme.provider);
          const rootRole = root.subagent_role || "Main";
          const isRootWorking = root.status === "working" || root.status === "waiting";
          const svgHeight = Math.max(120, children.length * 76 + 24);
          const rootY = svgHeight / 2;

          return (
            <div
              key={root.id}
              className={`relative rounded-xl border p-4 bg-slate-900/60 overflow-x-auto ${rootTheme.borderClass}`}
            >
              {children.length === 0 ? (
                /* Single Orchestrator Node with no spawned children yet */
                <div
                  onClick={() => onSelectAgent(root)}
                  className={`cursor-pointer rounded-xl border p-3.5 transition-all hover:scale-[1.01] ${rootTheme.borderClass} ${rootTheme.bgGradientClass} ${rootTheme.glowClass}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${rootTheme.providerPillClass}`}
                    >
                      {rootTheme.provider === "antigravity" ? (
                        <Sparkles className="w-3 h-3" />
                      ) : (
                        <Flame className="w-3 h-3" />
                      )}
                      {rootTheme.providerLabel}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${rootTheme.badgeClass}`}
                    >
                      {rootRole} · {rootModel}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-100 truncate">
                    {session?.name || root.name}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {root.current_tool
                      ? `⚡ ${root.current_tool}`
                      : root.task || session?.prompt_preview || "Ready for subagent delegation"}
                  </p>
                </div>
              ) : (
                /* Orchestrator -> Animated SVG Bezier Curves -> Spawned Child Subagents */
                <div
                  className="grid grid-cols-[minmax(190px,225px)_68px_minmax(220px,1fr)] items-center min-w-[500px]"
                  style={{ minHeight: `${svgHeight}px` }}
                >
                  {/* Left Column: Parent Orchestrator Node */}
                  <div
                    onClick={() => onSelectAgent(root)}
                    className={`cursor-pointer rounded-xl border-2 p-3 transition-all hover:scale-[1.02] ${rootTheme.borderClass} ${rootTheme.bgGradientClass} ${rootTheme.glowClass}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${rootTheme.providerPillClass}`}
                      >
                        {rootTheme.provider === "antigravity" ? (
                          <Sparkles className="w-2.5 h-2.5" />
                        ) : (
                          <Flame className="w-2.5 h-2.5" />
                        )}
                        {rootTheme.providerLabel}
                      </span>
                      {/* 4-Bar Effort Meter */}
                      <span className="flex items-end gap-0.5 h-2.5" title={rootTheme.effortLabel}>
                        {[1, 2, 3, 4].map((b) => (
                          <span
                            key={b}
                            className={`w-1 rounded-sm ${
                              b <= rootTheme.effortBars
                                ? rootTheme.barActiveClass
                                : "bg-slate-700/50"
                            }`}
                            style={{ height: `${b * 25}%` }}
                          />
                        ))}
                      </span>
                    </div>

                    <p className="text-xs font-bold text-slate-100 truncate" title={root.name}>
                      {session?.name || root.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${rootTheme.badgeClass}`}
                      >
                        {rootModel}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {rootTheme.effortLabel}
                      </span>
                    </div>

                    <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1 text-slate-300 truncate">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${rootTheme.dotClass} ${
                            isRootWorking ? "animate-ping" : ""
                          }`}
                        />
                        <span className="truncate font-mono">
                          {root.current_tool || root.status}
                        </span>
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

                  {/* Center Column: Animated SVG Bezier Curves */}
                  <svg
                    width="68"
                    height={svgHeight}
                    viewBox={`0 0 68 ${svgHeight}`}
                    className="overflow-visible"
                  >
                    {children.map((child, idx) => {
                      const childTheme = getAgentThermalTheme(
                        child,
                        session?.provider,
                        session?.model
                      );
                      const step = svgHeight / (children.length + 1);
                      const childY = Math.round(step * (idx + 1));
                      const isChildWorking =
                        child.status === "working" || child.status === "waiting";
                      const pathD = `M 2 ${rootY} C 34 ${rootY}, 34 ${childY}, 66 ${childY}`;

                      return (
                        <g key={child.id}>
                          {/* Base curve */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke={childTheme.svgStroke}
                            strokeOpacity={0.28}
                            strokeWidth={2}
                          />
                          {/* Pulsing dashed telemetry stream curve */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke={childTheme.svgStroke}
                            strokeWidth={2.25}
                            strokeDasharray={isChildWorking ? "5 5" : "none"}
                            strokeOpacity={isChildWorking ? 0.95 : 0.55}
                            className={isChildWorking ? "animate-pulse" : ""}
                          />
                          <circle cx={66} cy={childY} r={3} fill={childTheme.svgStroke} />
                        </g>
                      );
                    })}
                    <circle cx={2} cy={rootY} r={3.5} fill={rootTheme.svgStroke} />
                  </svg>

                  {/* Right Column: Spawned Child Subagent Nodes */}
                  <div className="flex flex-col justify-around gap-2 py-1">
                    {children.map((child) => {
                      const childTheme = getAgentThermalTheme(
                        child,
                        session?.provider,
                        session?.model
                      );
                      const childModel = formatAgentModelBadge(child.model, childTheme.provider);
                      const childRole = child.subagent_role || child.subagent_type || "Subagent";
                      const isChildWorking =
                        child.status === "working" || child.status === "waiting";

                      return (
                        <div
                          key={child.id}
                          onClick={() => onSelectAgent(child)}
                          className={`cursor-pointer rounded-xl border p-2.5 transition-all hover:scale-[1.01] ${childTheme.borderClass} ${childTheme.bgGradientClass} ${childTheme.glowClass}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full flex-shrink-0 ${childTheme.dotClass} ${
                                  isChildWorking ? "animate-pulse" : ""
                                }`}
                              />
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
                            className="text-[11px] text-slate-300 truncate mt-1"
                            title={child.task || child.name}
                          >
                            {child.task || child.name}
                          </p>

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
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
