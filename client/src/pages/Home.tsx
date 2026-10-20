/**
 * @file Home.tsx
 * @description Home of the Nexus Console, the "answers first" command center. Above the fold it
 * answers three questions in order: does anything need me (Needs-you slips), how much Claude Direct
 * quota is left and when it runs out (the fuel card, with the agy-cascade waterfall that protects it),
 * and what my agents are doing right now (live agent tree plus the latest events). Today's totals sit
 * beside the fuel card. Everything links one click deeper (Agents, Sessions, Usage); the agent
 * inspector opens in place.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { useDataScope } from "../lib/dataScope";
import { mergeFreshestById } from "../lib/merge-by-id";
import {
  formatHours,
  formatTokens,
  quotaTone,
  summarizeClaudeWindow,
  useQuotaTelemetry,
} from "../lib/useQuotaTelemetry";
import type { Agent, DashboardEvent, Session, Stats, WSMessage } from "../lib/types";
import { usePaletteAction } from "../components/PaletteActionProvider";
import { AgentInspectorDrawer } from "../components/AgentInspectorDrawer";
import { AgentOutline } from "../components/console/AgentOutline";
import { NeedsYouStrip, useNeedsYouCount } from "../components/console/NeedsYou";
import { PixelMeter } from "../components/console/PixelMeter";
import { poolMeta, poolStates } from "../components/console/pools";
import { sanitizeAgentText } from "../utils/agentTheme";

const EVENT_LIMIT = 8;

/** Card shell shared by the Home panels. */
function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: { to: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card flex min-w-0 flex-col p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="section-title">{title}</h2>
        {action && (
          <Link
            to={action.to}
            className="inline-flex items-center gap-1 text-[13px] text-gray-400 transition-colors hover:text-gray-100"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Claude Direct fuel card: the one big number on the page. */
function FuelCard() {
  const { t } = useTranslation("console");
  const { quota, cascade } = useQuotaTelemetry();
  const claude = summarizeClaudeWindow(quota);
  const tone = claude ? quotaTone(claude.freeFraction) : "ok";
  const fill =
    tone === "critical" ? "bg-coral-400" : tone === "low" ? "bg-amber-400" : poolMeta(3).fill;
  const states = poolStates(cascade);

  return (
    <Panel
      title={t("home.fuelTitle")}
      action={{ to: "/usage", label: t("home.details") }}
      className="lg:col-span-2"
    >
      {!claude ? (
        <p className="text-sm text-gray-500">{t("quota.loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <p className="font-pixel text-[52px] leading-none tracking-tight text-gray-50 tabular-nums">
              {claude.hoursToEmpty != null
                ? formatHours(claude.hoursToEmpty)
                : `${Math.round(claude.freeFraction * 100)}%`}
            </p>
            <p className="pb-1 text-[13px] text-gray-400">
              {claude.hoursToEmpty != null ? t("home.untilEmpty") : t("home.freeIdle")}
            </p>
          </div>
          <p className="mt-2 text-[13px] text-gray-400">
            {t("home.fuelLine", {
              used: formatTokens(claude.used),
              cap: formatTokens(claude.cap),
              burn: formatTokens(claude.burnPerHour),
              pct: Math.round(claude.freeFraction * 100),
            })}
          </p>
          <PixelMeter
            value={claude.freeFraction}
            blocks={40}
            fillClass={fill}
            heightClass="h-3"
            className="mt-4"
            label={t("quota.meterLabel")}
          />
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <ol
              className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]"
              aria-label={t("quota.waterfall")}
            >
              {states.map(({ meta, state }, i) => (
                <li key={meta.number} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-gray-600" aria-hidden />}
                  <span
                    className={`status-dot ${state === "exhausted" ? "bg-coral-400" : meta.dot}`}
                  />
                  <span
                    className={state === "active" ? "font-medium text-gray-50" : "text-gray-400"}
                  >
                    {t(`pools.${meta.key}`)}
                  </span>
                  <span className="text-xs text-gray-500">{t(`poolState.short.${state}`)}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px] text-gray-400">
              {t("home.keptOff", { tokens: formatTokens(cascade?.tokens_offloaded ?? 0) })}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Today's totals. */
function TodayCard({ stats, totalCost }: { stats: Stats | null; totalCost: number | null }) {
  const { t } = useTranslation("console");
  const rows: Array<[string, string]> = stats
    ? [
        [t("home.today.activeAgents"), String(stats.active_agents)],
        [
          t("home.today.sessions"),
          t("home.today.sessionsValue", {
            active: stats.active_sessions,
            total: stats.total_sessions,
          }),
        ],
        [t("home.today.events"), stats.events_today.toLocaleString()],
        [t("home.today.allEvents"), stats.total_events.toLocaleString()],
        [t("home.today.cost"), totalCost != null ? `$${totalCost.toFixed(2)}` : "--"],
      ]
    : [];
  return (
    <Panel title={t("home.todayTitle")} action={{ to: "/sessions", label: t("home.sessions") }}>
      <dl className="divide-y divide-border/70">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-[13px] text-gray-400">{label}</dt>
            <dd className="text-[15px] font-semibold tabular-nums text-gray-50">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Time of day greeting key. */
function greetingKey(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 19 ? "afternoon" : "evening";
}

/**
 * Home page.
 *
 * @returns The page.
 */
export function Home() {
  const { t } = useTranslation("console");
  const [scope] = useDataScope();
  const [stats, setStats] = useState<Stats | null>(null);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessionsById, setSessionsById] = useState<Map<string, Session>>(new Map());
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [inspected, setInspected] = useState<Agent | null>(null);
  const needsYou = useNeedsYouCount();

  const load = useCallback(async () => {
    try {
      const [statsRes, working, waiting, eventsRes, costRes, sessionsRes] = await Promise.all([
        api.stats.get(),
        api.agents.list({ status: "working", limit: 50 }),
        api.agents.list({ status: "waiting", limit: 50, include_transient: true }),
        api.events.list({ limit: EVENT_LIMIT }),
        api.pricing.totalCost(),
        api.sessions.list({ status: "active", limit: 100, include_transient: true }),
      ]);
      const active = mergeFreshestById(working.agents, waiting.agents);
      // Pull each live session's full tree so subagents (and finished siblings) nest correctly.
      const sessionIds = [...new Set(active.map((a) => a.session_id))].slice(0, 12);
      const trees = await Promise.all(
        sessionIds.map((sid) => api.agents.list({ session_id: sid, limit: 100 }))
      );
      setAgents(mergeFreshestById(active, ...trees.map((r) => r.agents)));
      setStats(statsRes);
      setTotalCost(costRes.total_cost);
      setEvents(eventsRes.events);
      setSessionsById(new Map(sessionsRes.sessions.map((s) => [s.id, s])));
    } catch {
      // Keep the last good view while the server is unreachable.
    }
  }, [scope]);

  usePaletteAction("page.refresh", () => void load());

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [load]);

  // Live updates: new events slide in at the top; agent changes trigger a throttled reload.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "new_event" && msg.data) {
        const ev = msg.data as DashboardEvent;
        setEvents((prev) => [ev, ...prev.filter((e) => e.id !== ev.id)].slice(0, EVENT_LIMIT));
        setFreshIds((prev) => new Set(prev).add(ev.id));
      }
      if (msg.type === "agent_created" || msg.type === "agent_updated") {
        if (!reloadTimer.current) {
          reloadTimer.current = setTimeout(() => {
            reloadTimer.current = null;
            void load();
          }, 1500);
        }
      }
    });
    return () => {
      unsubscribe();
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [load]);

  const working = useMemo(() => agents.filter((a) => a.status === "working").length, [agents]);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <h1 className="page-title">{t(`home.greeting.${greetingKey()}`)}</h1>
        <p className="mt-1 text-[14px] text-gray-400">
          {t("home.statusLine", { working, count: needsYou })}
        </p>
      </header>

      <NeedsYouStrip />

      <div className="grid gap-4 lg:grid-cols-3">
        <FuelCard />
        <TodayCard stats={stats} totalCost={totalCost} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          title={t("home.liveTitle")}
          action={{ to: "/agents", label: t("home.openAgents") }}
          className="lg:col-span-3"
        >
          <AgentOutline
            agents={agents}
            onSelect={setInspected}
            selectedId={inspected?.id}
            maxRoots={8}
          />
        </Panel>
        <Panel
          title={t("home.eventsTitle")}
          action={{ to: "/sessions?show=events", label: t("home.allEvents") }}
          className="lg:col-span-2"
        >
          {events.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-500">{t("home.noEvents")}</p>
          ) : (
            <ol className="flex flex-col">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
                    freshIds.has(ev.id) ? "animate-row-flash motion-reduce:animate-none" : ""
                  }`}
                >
                  <time
                    className="w-11 shrink-0 font-mono text-[11px] text-gray-500"
                    dateTime={ev.created_at}
                  >
                    {new Date(ev.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </time>
                  <span className="w-20 shrink-0 truncate text-xs font-medium text-gray-300">
                    {ev.tool_name || ev.event_type}
                  </span>
                  <Link
                    to={`/sessions/${encodeURIComponent(ev.session_id)}`}
                    className="min-w-0 flex-1 truncate text-[13px] text-gray-400 hover:text-gray-100"
                    title={ev.summary ?? undefined}
                  >
                    {sanitizeAgentText(ev.summary || "") || ev.event_type}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <AgentInspectorDrawer
        agent={inspected}
        session={inspected ? (sessionsById.get(inspected.session_id) ?? null) : null}
        onClose={() => setInspected(null)}
        onAgentUpdated={() => void load()}
      />
    </div>
  );
}
