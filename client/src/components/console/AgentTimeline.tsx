/**
 * @file AgentTimeline.tsx
 * @description Timeline (waterfall) view of agents: one row per agent, a bar from its start to its end
 * (or to "now" while it runs) inside a selectable time window, filled with its pool ink. Running bars
 * reach the live edge; finished bars are dimmed; errors get a coral end cap. It shows concurrency and
 * stalls at a glance, the job the tree cannot do. Rows are buttons that open the shared inspector.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../../lib/types";
import {
  getAgentThermalTheme,
  resolveQuotaPoolBadge,
  sanitizeAgentText,
} from "../../utils/agentTheme";
import { PixelAvatar } from "../PixelAvatar";
import { poolMeta } from "./pools";

/** Selectable windows, in minutes. */
const WINDOWS = [30, 120, 720] as const;
type WindowMinutes = (typeof WINDOWS)[number];

/** Props for {@link AgentTimeline}. */
export interface AgentTimelineProps {
  agents: readonly Agent[];
  onSelect?: (agent: Agent) => void;
  selectedId?: string | null;
}

/**
 * Agent timeline.
 *
 * @returns The timeline.
 */
export function AgentTimeline({ agents, onSelect, selectedId }: AgentTimelineProps) {
  const { t } = useTranslation("console");
  const [windowMin, setWindowMin] = useState<WindowMinutes>(120);
  const [now, setNow] = useState(() => Date.now());

  // Advance the live edge every 15 s; cheap, and enough for minute-scale bars.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const t0 = now - windowMin * 60000;
  const rows = useMemo(
    () =>
      agents
        .map((agent) => {
          const start = Date.parse(agent.started_at);
          const end = agent.ended_at ? Date.parse(agent.ended_at) : now;
          return { agent, start, end };
        })
        .filter((r) => Number.isFinite(r.start) && r.end >= t0)
        .sort((a, b) => a.start - b.start),
    [agents, now, t0]
  );

  const span = now - t0;
  const ticks = Array.from({ length: 5 }, (_, i) => t0 + (span * i) / 4);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-gray-400">{t("timeline.hint")}</p>
        <div className="segmented" role="tablist" aria-label={t("timeline.window")}>
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={w === windowMin}
              onClick={() => setWindowMin(w)}
              className="segmented-item"
            >
              {t(`timeline.windows.${w}`)}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-gray-500">{t("timeline.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[260px_1fr] border-b border-border pb-1 text-[11px] text-gray-500">
              <span />
              <div className="relative h-4">
                {ticks.map((tick, i) => (
                  <span
                    key={tick}
                    className="absolute -translate-x-1/2 tabular-nums"
                    style={{ left: `${(i / 4) * 100}%` }}
                  >
                    {i === 4
                      ? t("timeline.now")
                      : new Date(tick).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </span>
                ))}
              </div>
            </div>
            <ul>
              {rows.map(({ agent, start, end }) => {
                const pool = poolMeta(
                  resolveQuotaPoolBadge(getAgentThermalTheme(agent).provider).pool
                );
                const left = Math.max(0, ((start - t0) / span) * 100);
                const width = Math.max(
                  0.6,
                  ((Math.min(end, now) - Math.max(start, t0)) / span) * 100
                );
                const running = !agent.ended_at && agent.status !== "completed";
                const title = sanitizeAgentText(agent.task || "") || agent.name;
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(agent)}
                      className={`grid h-8 w-full grid-cols-[260px_1fr] items-center rounded-md text-left transition-colors ${
                        selectedId === agent.id ? pool.wash : "hover:bg-surface-2"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2 pl-2 pr-3">
                        <PixelAvatar
                          agent={agent}
                          size={12}
                          framed={false}
                          indicator={false}
                          showBadge={false}
                        />
                        <span className="truncate text-[13px] text-gray-200" title={title}>
                          {title}
                        </span>
                      </span>
                      <span className="relative h-full">
                        {ticks.slice(1, 4).map((tick) => (
                          <span
                            key={tick}
                            className="absolute inset-y-1 w-px bg-border/60"
                            style={{ left: `${((tick - t0) / span) * 100}%` }}
                            aria-hidden
                          />
                        ))}
                        <span
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-[2px] ${pool.fill} ${
                            running ? "" : "opacity-40"
                          } ${agent.status === "error" ? "border-r-2 border-coral-400" : ""}`}
                          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                          aria-label={t(
                            `status.${agent.status === "error" ? "error" : running ? "working" : "completed"}`
                          )}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
