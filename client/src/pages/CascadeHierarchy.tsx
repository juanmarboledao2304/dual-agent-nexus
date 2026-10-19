/**
 * @file CascadeHierarchy.tsx
 * @description Cascade Hierarchy page (`/cascade-graph`, formerly `/workflows`). Leads with the
 * live 3-level waterfall graph — L1 conductor, L2 `agy-cascade` bridge, L3 fan-out specialists,
 * drawn with 8-bit agent sprites — and keeps the workflow intelligence views (orchestration DAG,
 * tool flow, patterns) below it.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { useDataScope } from "../lib/dataScope";
import { mergeFreshestById } from "../lib/merge-by-id";
import { SubagentGraph } from "../components/SubagentGraph";
import { AgentInspectorDrawer } from "../components/AgentInspectorDrawer";
import { Workflows } from "./Workflows";
import type { Agent, Session, WSMessage } from "../lib/types";

/** Completed agents fetched so recently finished trees stay on the graph. */
const COMPLETED_LIMIT = 80;

/**
 * Cascade Hierarchy route: the live waterfall graph above the workflow analytics.
 *
 * @returns The page.
 */
export function CascadeHierarchy() {
  const [dataScope] = useDataScope();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [inspected, setInspected] = useState<Agent | null>(null);

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
      // Keep the last good graph while the server is unreachable.
    }
  }, [dataScope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "agent_created" || msg.type === "agent_updated") {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void load(), 300);
      }
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [load]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  const mains = useMemo(() => agents.filter((a) => a.type === "main"), [agents]);
  const subagents = useMemo(() => agents.filter((a) => a.type === "subagent"), [agents]);
  const hasTrees = subagents.some((s) => mains.some((m) => m.session_id === s.session_id));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-semibold text-slate-100 tracking-tight">Cascade Hierarchy</h1>
        <p className="text-xs text-slate-400">
          Live L1 conductor / L2 agy-cascade bridge / L3 fan-out topology, followed by workflow
          intelligence.
        </p>
      </div>

      {hasTrees ? (
        <SubagentGraph
          agents={mains}
          subagents={subagents}
          sessionsById={sessionsById}
          onSelectAgent={setInspected}
          onRefresh={() => void load()}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/80 p-8 text-center">
          <GitBranch className="w-5 h-5 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            No delegation trees yet. Start a conductor session or Run Swarm Simulation to see the
            3-level hierarchy.
          </p>
        </div>
      )}

      <Workflows />

      <AgentInspectorDrawer
        agent={inspected}
        session={inspected ? sessionsById.get(inspected.session_id) : null}
        onClose={() => setInspected(null)}
        onAgentUpdated={() => void load()}
      />
    </div>
  );
}
