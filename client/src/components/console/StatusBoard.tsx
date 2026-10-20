/**
 * @file StatusBoard.tsx
 * @description Board view of agents: four columns by status (Needs you, Working, Waiting, Done) with
 * two-line cards carrying the pool ink, the 8-bit sprite, the task, model, current tool, and how long
 * ago the agent last did something. "Needs you" uses the same strict rule as the top-bar bell; working
 * agents with no event for 10 minutes are flagged as quiet in place. Cards open the shared inspector,
 * which holds each agent's event log. Replaces the former Rooms and Kanban boards.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../../lib/types";
import { classifyAttention, STALL_MINUTES } from "../../lib/useAttention";
import { timeAgo } from "../../lib/format";
import {
  getAgentThermalTheme,
  resolveQuotaPoolBadge,
  sanitizeAgentText,
} from "../../utils/agentTheme";
import { PixelAvatar } from "../PixelAvatar";
import { poolMeta } from "./pools";

type Column = "needs" | "working" | "waiting" | "done";
const COLUMNS: readonly Column[] = ["needs", "working", "waiting", "done"];
const COLUMN_DOT: Record<Column, string> = {
  needs: "bg-paper",
  working: "bg-mint-400",
  waiting: "bg-amber-400",
  done: "bg-gray-600",
};
/** Finished agents shown, newest first. */
const DONE_LIMIT = 30;

/** Props for {@link StatusBoard}. */
export interface StatusBoardProps {
  agents: readonly Agent[];
  onSelect?: (agent: Agent) => void;
  selectedId?: string | null;
}

/** One agent card. */
function Card({
  agent,
  reason,
  quiet,
  selected,
  onSelect,
}: {
  agent: Agent;
  reason?: string;
  quiet?: string;
  selected: boolean;
  onSelect?: (agent: Agent) => void;
}) {
  const theme = getAgentThermalTheme(agent);
  const pool = poolMeta(resolveQuotaPoolBadge(theme.provider).pool);
  const title = sanitizeAgentText(agent.task || "") || agent.name;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(agent)}
        className={`w-full rounded-lg border border-border border-l-2 ${pool.tab} bg-surface-1 px-3 py-2.5 text-left transition-colors hover:border-border-light hover:bg-surface-2 ${
          selected ? pool.wash : ""
        }`}
      >
        <span className="flex items-start gap-2">
          <PixelAvatar agent={agent} size={14} framed={false} indicator={false} showBadge={false} />
          <span
            className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug text-gray-100"
            title={title}
          >
            {title}
          </span>
        </span>
        {reason && <span className="mt-1.5 block text-xs font-medium text-gray-50">{reason}</span>}
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
          <span>{theme.modelShortName}</span>
          {agent.current_tool && agent.status === "working" && (
            <span className="rounded bg-surface-3 px-1.5 font-mono text-[11px] text-gray-300">
              {agent.current_tool}
            </span>
          )}
          <span className={quiet ? "text-amber-300" : ""}>
            {quiet ?? timeAgo(agent.updated_at)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Status board.
 *
 * @returns The board.
 */
export function StatusBoard({ agents, onSelect, selectedId }: StatusBoardProps) {
  const { t } = useTranslation("console");

  const columns = useMemo(() => {
    const now = Date.now();
    const attention = classifyAttention(agents, now).filter((i) => i.kind !== "stalled");
    const needsIds = new Set(attention.map((i) => i.agent.id));
    const byRecent = (a: Agent, b: Agent) => Date.parse(b.updated_at) - Date.parse(a.updated_at);
    return {
      needs: attention,
      working: agents.filter((a) => a.status === "working" && !needsIds.has(a.id)).sort(byRecent),
      waiting: agents.filter((a) => a.status === "waiting" && !needsIds.has(a.id)).sort(byRecent),
      done: agents
        .filter((a) => (a.status === "completed" || a.status === "error") && !needsIds.has(a.id))
        .sort(byRecent)
        .slice(0, DONE_LIMIT),
    };
  }, [agents]);

  const now = Date.now();
  const quietLabel = (a: Agent) => {
    const idle = (now - Date.parse(a.updated_at)) / 60000;
    return idle >= STALL_MINUTES ? t("board.quiet", { minutes: Math.round(idle) }) : undefined;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const count = columns[col].length;
        return (
          <section key={col} aria-labelledby={`board-${col}`} className="flex min-w-0 flex-col">
            <h2
              id={`board-${col}`}
              className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-gray-100"
            >
              <span className={`status-dot ${COLUMN_DOT[col]}`} aria-hidden />
              {t(`board.columns.${col}`)}
              <span className="font-normal tabular-nums text-gray-500">{count}</span>
            </h2>
            {count === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-gray-500">
                {t(`board.empty.${col}`)}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {col === "needs"
                  ? columns.needs.map((item) => (
                      <Card
                        key={item.agent.id}
                        agent={item.agent}
                        reason={t(`needsYou.kind.${item.kind}`, {
                          minutes: Math.round(item.idleMinutes),
                          tool: item.loop?.tool ?? "",
                          count: item.loop?.count ?? 0,
                        })}
                        selected={selectedId === item.agent.id}
                        onSelect={onSelect}
                      />
                    ))
                  : columns[col].map((agent) => (
                      <Card
                        key={agent.id}
                        agent={agent}
                        quiet={col === "working" ? quietLabel(agent) : undefined}
                        selected={selectedId === agent.id}
                        onSelect={onSelect}
                      />
                    ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
