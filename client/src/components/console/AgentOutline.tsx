/**
 * @file AgentOutline.tsx
 * @description Indented, scannable agent tree: one 36px row per agent with a thin pool-ink tab on the
 * left, the agent's 8-bit sprite, its task or name, model, context use, current tool, and a status
 * shown as colour plus word. Children nest under their parent via `parent_agent_id`; finished children
 * fold into a "N done" line so live work stays on screen. Rows are buttons, so the tree is keyboard
 * reachable, and selecting one opens the shared agent inspector. Used by Home (live agents) and by the
 * Agents page's Tree view.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { Agent } from "../../lib/types";
import {
  getAgentThermalTheme,
  resolveQuotaPoolBadge,
  sanitizeAgentText,
} from "../../utils/agentTheme";
import { isAwaitingApproval } from "../../utils/pixelSprites";
import { PixelAvatar } from "../PixelAvatar";
import { poolMeta } from "./pools";

/** Status presentation: dot colour plus a word, never colour alone. */
function statusOf(agent: Agent): { key: string; dot: string; text: string } {
  if (isAwaitingApproval(agent)) return { key: "approval", dot: "bg-paper", text: "text-gray-50" };
  switch (agent.status) {
    case "working":
      return { key: "working", dot: "bg-mint-400 animate-pulse-dot", text: "text-gray-200" };
    case "waiting":
      return { key: "waiting", dot: "bg-amber-400", text: "text-gray-300" };
    case "error":
      return { key: "error", dot: "bg-coral-400", text: "text-coral-300" };
    default:
      return { key: "completed", dot: "bg-gray-600", text: "text-gray-500" };
  }
}

/** Props for {@link AgentOutline}. */
export interface AgentOutlineProps {
  agents: readonly Agent[];
  /** Called when a row is chosen. */
  onSelect?: (agent: Agent) => void;
  /** Highlighted agent id. */
  selectedId?: string | null;
  /** Cap on rendered top-level trees (the rest are summarized). */
  maxRoots?: number;
  /** Fold finished children into a count line (default true). */
  foldFinished?: boolean;
}

/** One rendered row with its depth. */
interface Row {
  agent: Agent;
  depth: number;
}

/**
 * Agent tree.
 *
 * @returns The outline.
 */
export function AgentOutline({
  agents,
  onSelect,
  selectedId,
  maxRoots,
  foldFinished = true,
}: AgentOutlineProps) {
  const { t } = useTranslation("console");
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());

  const { roots, children } = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const kids = new Map<string, Agent[]>();
    const top: Agent[] = [];
    for (const a of agents) {
      if (a.parent_agent_id && byId.has(a.parent_agent_id) && a.parent_agent_id !== a.id) {
        const list = kids.get(a.parent_agent_id) ?? [];
        list.push(a);
        kids.set(a.parent_agent_id, list);
      } else {
        top.push(a);
      }
    }
    const rank = (a: Agent) =>
      isAwaitingApproval(a) ? 0 : a.status === "working" ? 1 : a.status === "waiting" ? 2 : 3;
    const sort = (list: Agent[]) =>
      list.sort((a, b) => rank(a) - rank(b) || Date.parse(b.updated_at) - Date.parse(a.updated_at));
    sort(top);
    for (const list of kids.values()) sort(list);
    return { roots: top, children: kids };
  }, [agents]);

  const shownRoots = maxRoots ? roots.slice(0, maxRoots) : roots;
  const hiddenRoots = roots.length - shownRoots.length;

  const lines: Array<
    { type: "agent"; row: Row } | { type: "folded"; parentId: string; depth: number; count: number }
  > = [];
  const seen = new Set<string>();
  const walk = (agent: Agent, depth: number) => {
    if (seen.has(agent.id)) return; // corrupt parent cycles
    seen.add(agent.id);
    lines.push({ type: "agent", row: { agent, depth } });
    const kids = children.get(agent.id) ?? [];
    const live =
      foldFinished && !expandedDone.has(agent.id)
        ? kids.filter((k) => k.status !== "completed")
        : kids;
    for (const k of live) walk(k, depth + 1);
    const folded = kids.length - live.length;
    if (folded > 0)
      lines.push({ type: "folded", parentId: agent.id, depth: depth + 1, count: folded });
  };
  for (const r of shownRoots) walk(r, 0);

  if (agents.length === 0) {
    return <p className="px-1 py-6 text-center text-[13px] text-gray-500">{t("agents.empty")}</p>;
  }

  return (
    <ul className="flex flex-col" role="tree" aria-label={t("agents.treeLabel")}>
      {lines.map((line) => {
        if (line.type === "folded") {
          return (
            <li key={`fold-${line.parentId}`} role="none">
              <button
                type="button"
                onClick={() => setExpandedDone((prev) => new Set(prev).add(line.parentId))}
                className="flex h-8 w-full items-center gap-1.5 rounded-md text-left text-xs text-gray-500 transition-colors hover:bg-surface-2 hover:text-gray-300"
                style={{ paddingLeft: `${12 + line.depth * 20}px` }}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                {t("agents.foldedDone", { count: line.count })}
              </button>
            </li>
          );
        }
        const { agent, depth } = line.row;
        const theme = getAgentThermalTheme(agent);
        const pool = poolMeta(resolveQuotaPoolBadge(theme.provider).pool);
        const status = statusOf(agent);
        const title = sanitizeAgentText(agent.task || "") || agent.name;
        const ctx = agent.context_utilization_pct;
        const selected = selectedId === agent.id;
        return (
          <li key={agent.id} role="treeitem" aria-selected={selected} aria-level={depth + 1}>
            <button
              type="button"
              onClick={() => onSelect?.(agent)}
              className={`group flex h-9 w-full items-center gap-2.5 rounded-md border-l-2 pr-2 text-left transition-colors ${pool.tab} ${
                selected ? `${pool.wash} text-gray-50` : "hover:bg-surface-2"
              }`}
              style={{ paddingLeft: `${10 + depth * 20}px` }}
            >
              {depth > 0 && <span className="h-px w-2.5 shrink-0 bg-border-light" aria-hidden />}
              <PixelAvatar
                agent={agent}
                size={14}
                framed={false}
                indicator={false}
                showBadge={false}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-100" title={title}>
                {title}
              </span>
              {agent.current_tool && agent.status === "working" && (
                <span className="hidden shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-gray-300 lg:inline">
                  {agent.current_tool}
                </span>
              )}
              <span
                className="hidden w-24 shrink-0 truncate text-xs text-gray-500 md:inline"
                title={t(`pools.${pool.key}`)}
              >
                {theme.modelShortName}
              </span>
              <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-gray-500 sm:inline">
                {typeof ctx === "number" && ctx > 0
                  ? t("agents.ctx", { pct: Math.round(ctx) })
                  : ""}
              </span>
              <span
                className={`flex w-28 shrink-0 items-center justify-end gap-1.5 text-xs ${status.text}`}
              >
                <span className={`status-dot ${status.dot}`} aria-hidden />
                {t(`status.${status.key}`)}
              </span>
            </button>
          </li>
        );
      })}
      {hiddenRoots > 0 && (
        <li role="none" className="px-3 pt-1 text-xs text-gray-500">
          {t("agents.moreTrees", { count: hiddenRoots })}
        </li>
      )}
    </ul>
  );
}
