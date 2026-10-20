/**
 * @file AgentsHub.tsx
 * @description The Agents section: one page, four views of the same agents, so the cascade hierarchy is
 * drawn in exactly one place. Tree (default) is an indented outline with a node-link Graph toggle;
 * Timeline shows concurrency and stalls; Board sorts agents into status columns (it replaced the old
 * Rooms and Kanban pages); World is the 8-bit office with its sandbox. Tree, Timeline, and Board share
 * one data load and the agent inspector. The view lives in the URL (`?mode=`) so old routes and the command
 * palette can deep-link into it. A swarm simulation can be started from here.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, GanttChart, Gamepad2, ListTree, Columns3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { useDataScope } from "../lib/dataScope";
import { mergeFreshestById } from "../lib/merge-by-id";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { useQuotaTelemetry } from "../lib/useQuotaTelemetry";
import type { Agent, Session, WSMessage } from "../lib/types";
import { AgentInspectorDrawer } from "../components/AgentInspectorDrawer";
import { SubagentGraph } from "../components/SubagentGraph";
import { AgentOutline } from "../components/console/AgentOutline";
import { AgentTimeline } from "../components/console/AgentTimeline";
import { StatusBoard } from "../components/console/StatusBoard";
import { POOLS } from "../components/console/pools";
import { useNeedsYouCount } from "../components/console/NeedsYou";
import { AgentWorld } from "./AgentWorld";

/** Views, in toolbar order. */
export const AGENT_MODES = ["tree", "timeline", "board", "world"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

const MODE_ICON: Record<AgentMode, LucideIcon> = {
  tree: ListTree,
  timeline: GanttChart,
  board: Columns3,
  world: Gamepad2,
};

const TREE_STYLES = ["outline", "graph"] as const;

/** Completed agents fetched so recently finished trees stay visible. */
const COMPLETED_LIMIT = 80;

/**
 * Agents page.
 *
 * @returns The page.
 */
export function AgentsHub() {
  const { t } = useTranslation("console");
  const [mode, setMode] = useUrlTab(AGENT_MODES, "tree", {
    param: "mode",
    storageKey: "agents-mode",
  });
  const [treeStyle, setTreeStyle] = useUrlTab(TREE_STYLES, "outline", {
    param: "style",
    storageKey: "agents-tree-style",
  });
  const [scope] = useDataScope();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [inspected, setInspected] = useState<Agent | null>(null);
  const { simulating } = useQuotaTelemetry();
  const needsYou = useNeedsYouCount();
  const [simMessage, setSimMessage] = useState<string | null>(null);

  const usesSharedData = mode !== "world";

  const load = useCallback(async () => {
    try {
      const [working, waiting, completed, sessionsRes] = await Promise.all([
        api.agents.list({ status: "working" }),
        api.agents.list({ status: "waiting", include_transient: true }),
        api.agents.list({ status: "completed", limit: COMPLETED_LIMIT }),
        api.sessions.list({ limit: 500, include_transient: true }),
      ]);
      setAgents(mergeFreshestById(working.agents, waiting.agents, completed.agents));
      setSessions(sessionsRes.sessions);
    } catch {
      // Keep the last good view while the server is unreachable.
    }
  }, [scope]);

  useEffect(() => {
    if (!usesSharedData) return;
    void load();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "agent_created" || msg.type === "agent_updated") {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void load(), 400);
      }
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [load, usesSharedData]);

  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const live = agents.filter((a) => a.status === "working" || a.status === "waiting").length;

  const simulate = async () => {
    try {
      const res = await api.simulate.swarm();
      setSimMessage(res.message ?? null);
    } catch (err) {
      setSimMessage(err instanceof Error ? err.message : t("agents.simulateFailed"));
    }
    setTimeout(() => setSimMessage(null), 5000);
  };

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{t("agents.title")}</h1>
          <p className="mt-1 text-[14px] text-gray-400">
            {usesSharedData
              ? t("agents.summary", { total: agents.length, live, attention: needsYou })
              : t(`agents.modeHint.${mode}`)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ul
            className="mr-2 hidden items-center gap-3 text-xs text-gray-400 xl:flex"
            aria-label={t("agents.legend")}
          >
            {POOLS.map((p) => (
              <li key={p.number} className="flex items-center gap-1.5">
                <span className={`status-dot ${p.dot}`} aria-hidden />
                {t(`pools.${p.key}`)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void simulate()}
            disabled={simulating}
            className="btn-ghost border border-border disabled:opacity-50"
            title={t("agents.simulateHint")}
          >
            <Clapperboard className="h-3.5 w-3.5" aria-hidden />
            {simulating ? t("agents.simulating") : t("agents.simulate")}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="segmented" role="tablist" aria-label={t("agents.views")}>
          {AGENT_MODES.map((m) => {
            const Icon = MODE_ICON[m];
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className="segmented-item"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(`agents.modes.${m}`)}
              </button>
            );
          })}
        </div>
        {mode === "tree" && (
          <div className="segmented" role="tablist" aria-label={t("agents.treeStyle")}>
            {TREE_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={treeStyle === s}
                onClick={() => setTreeStyle(s)}
                className="segmented-item"
              >
                {t(`agents.treeStyles.${s}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {simMessage && (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-gray-300">
          {simMessage}
        </p>
      )}

      {mode === "tree" &&
        (treeStyle === "outline" ? (
          <section className="card p-3">
            <AgentOutline agents={agents} onSelect={setInspected} selectedId={inspected?.id} />
          </section>
        ) : (
          <SubagentGraph
            agents={agents.filter((a) => a.type === "main")}
            subagents={agents.filter((a) => a.type === "subagent")}
            sessionsById={sessionsById}
            onSelectAgent={setInspected}
            onRefresh={() => void load()}
          />
        ))}

      {mode === "timeline" && (
        <section className="card p-4">
          <AgentTimeline agents={agents} onSelect={setInspected} selectedId={inspected?.id} />
        </section>
      )}

      {mode === "board" && (
        <StatusBoard agents={agents} onSelect={setInspected} selectedId={inspected?.id} />
      )}
      {mode === "world" && <AgentWorld embedded />}

      {usesSharedData && (
        <AgentInspectorDrawer
          agent={inspected}
          session={inspected ? (sessionsById.get(inspected.session_id) ?? null) : null}
          onClose={() => setInspected(null)}
          onAgentUpdated={() => void load()}
        />
      )}
    </div>
  );
}
