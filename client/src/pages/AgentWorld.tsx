/**
 * @file AgentWorld.tsx
 * @description Agent World page: every agent as an 8-bit character working in a
 * 3/4-perspective office of four rooms (Conductor Bridge, Cascade Engine,
 * Fan-Out Pods, Digest Vault). Live agents stream in from the dashboard API and
 * WebSocket and are read-only; sandbox agents are a per-browser playground that
 * can be created, paused, resumed, renamed, moved, and deleted.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Pause, Play, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { useDataScope } from "../lib/dataScope";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { mergeFreshestById } from "../lib/merge-by-id";
import type { Agent, AgentStatus, Session, WSMessage } from "../lib/types";
import { ROOM_ZONES } from "../utils/agentRooms";
import type { RoomZoneId } from "../utils/agentRooms";
import { liveEntitiesFrom, sandboxEntitiesFrom } from "../utils/world/entities";
import type { WorldEntity, WorldSource } from "../utils/world/entities";
import { SANDBOX_MAX, loadSandbox, sandboxReducer, saveSandbox } from "../utils/world/sandbox";
import type { SandboxDraft } from "../utils/world/sandbox";
import { WorldCanvas } from "../components/world/WorldCanvas";
import { WorldSidePanel } from "../components/world/WorldSidePanel";
import type { WorldAgentSummary } from "../components/world/WorldSidePanel";
import { CreateAgentDialog } from "../components/world/CreateAgentDialog";
import { ConfirmModal } from "../components/ConfirmModal";
import { AgentInspectorDrawer } from "../components/AgentInspectorDrawer";

/** Agent statuses fetched for the world (same set as Agent Rooms). */
const FETCH_STATUSES: AgentStatus[] = ["working", "waiting", "completed", "error"];
/** Cap on finished agents fetched for the vault. */
const VAULT_FETCH_LIMIT = 24;
/** How often the side panel re-reads the simulation, in ms. */
const SNAPSHOT_MS = 400;

/** Track `prefers-reduced-motion`. */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** Summaries for the side panel, in a stable order (live first, then sandbox by creation). */
function summarize(map: Map<string, WorldEntity>): WorldAgentSummary[] {
  return Array.from(map.values(), ({ id, source, name, variant, zone, activity, task }) => ({
    id,
    source,
    name,
    variant,
    zone,
    activity,
    task,
  }));
}

/** Agent World page. */
export function AgentWorld() {
  const { t } = useTranslation("world");
  const [dataScope] = useDataScope();
  const reducedMotion = useReducedMotion();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sandbox, dispatch] = useReducer(sandboxReducer, undefined, loadSandbox);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorldSource>("live");
  const [summaries, setSummaries] = useState<WorldAgentSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const entitiesRef = useRef(new Map<string, WorldEntity>());
  const signatureRef = useRef("");

  const loadAgents = useCallback(async () => {
    const [agentResults, sessionsRes] = await Promise.all([
      Promise.all(
        FETCH_STATUSES.map((status) =>
          api.agents.list({
            status,
            include_transient: status === "waiting",
            ...(status === "completed" ? { limit: VAULT_FETCH_LIMIT } : {}),
          })
        )
      ),
      api.sessions.list({ limit: 500, include_transient: true }),
    ]);
    setAgents(mergeFreshestById(...agentResults.map((r) => r.agents)));
    setSessions(sessionsRes.sessions);
  }, [dataScope]);

  useEffect(() => {
    void loadAgents().catch(() => {});
  }, [loadAgents]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void loadAgents().catch(() => {}), 300);
    };
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (isRemoteDataRefreshMessage(msg)) {
        scheduleReload();
        return;
      }
      switch (msg.type) {
        case "agent_created":
        case "agent_updated":
        case "session_created":
        case "session_updated":
          scheduleReload();
          break;
        default:
          break;
      }
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [loadAgents]);

  useEffect(() => saveSandbox(sandbox), [sandbox]);

  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  /** Re-read the simulation into panel state, skipping renders when nothing visible changed. */
  const refreshSummaries = useCallback(() => {
    const next = summarize(entitiesRef.current);
    const signature = next
      .map((a) => `${a.id}|${a.name}|${a.zone}|${a.activity}|${a.variant}|${a.task ?? ""}`)
      .join("\n");
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    setSummaries(next);
  }, []);

  // Merge data updates into the simulation, preserving positions and behavior.
  useEffect(() => {
    const prev = entitiesRef.current;
    const now = performance.now() / 1000;
    const next = new Map<string, WorldEntity>();
    for (const e of liveEntitiesFrom(agents, sessionsById, prev)) next.set(e.id, e);
    for (const e of sandboxEntitiesFrom(sandbox, prev, now)) next.set(e.id, e);
    entitiesRef.current = next;
    refreshSummaries();
  }, [agents, sessionsById, sandbox, refreshSummaries]);

  useEffect(() => {
    const id = window.setInterval(refreshSummaries, SNAPSHOT_MS);
    return () => window.clearInterval(id);
  }, [refreshSummaries]);

  // Drop a selection whose agent left the world.
  useEffect(() => {
    if (selectedId && !entitiesRef.current.has(selectedId)) setSelectedId(null);
  }, [summaries, selectedId]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      const entity = id ? entitiesRef.current.get(id) : undefined;
      if (entity) setTab(entity.source);
    },
    [setSelectedId]
  );

  const zoneLabels = useMemo(
    () =>
      Object.fromEntries(ROOM_ZONES.map((z) => [z.id, t(`zones.${z.id}`)])) as Record<
        RoomZoneId,
        string
      >,
    [t]
  );

  const createAgent = (draft: SandboxDraft) => {
    const id = `sbx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({ type: "create", id, now: Date.now(), agent: draft });
    setCreating(false);
    setTab("sandbox");
    setSelectedId(id);
  };

  const deleteAgent = (id: string) => {
    dispatch({ type: "delete", id });
    if (selectedId === id) setSelectedId(null);
  };

  const liveCount = summaries.filter((a) => a.source === "live").length;
  const full = sandbox.length >= SANDBOX_MAX;
  const inspectedAgent = inspectedId ? (agents.find((a) => a.id === inspectedId) ?? null) : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="page-title">{t("title")}</h1>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[12px] text-gray-500">
            {t("counts", { live: liveCount, sandbox: sandbox.length })}
          </span>
          <button
            type="button"
            className="btn-ghost border border-border"
            onClick={() => setRecenterKey((k) => k + 1)}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            {t("recenter")}
          </button>
          <button
            type="button"
            className="btn-ghost border border-border"
            disabled={sandbox.length === 0}
            onClick={() => dispatch({ type: "pauseAll" })}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden />
            {t("pauseAll")}
          </button>
          <button
            type="button"
            className="btn-ghost border border-border"
            disabled={sandbox.length === 0}
            onClick={() => dispatch({ type: "resumeAll" })}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t("resumeAll")}
          </button>
          <button
            type="button"
            className="btn-ghost border border-border"
            disabled={sandbox.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t("clear")}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={full}
            title={full ? t("limit", { max: SANDBOX_MAX }) : undefined}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("create")}
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <div className="card h-[min(70vh,720px)] min-h-[420px] p-0">
            <WorldCanvas
              entitiesRef={entitiesRef}
              selectedId={selectedId}
              onSelect={select}
              onMoveSandbox={(id, x, y) => dispatch({ type: "move", id, x, y })}
              reducedMotion={reducedMotion}
              zoneLabels={zoneLabels}
              recenterKey={recenterKey}
              label={t("canvasLabel")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-accent/70" aria-hidden />
              {t("legendLive")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-gray-300"
                aria-hidden
              />
              {t("legendSandbox")}
            </span>
            <span className="text-gray-600">{t("controlsHint")}</span>
          </div>
        </div>

        <div className="lg:h-[min(70vh,720px)] lg:min-h-[420px]">
          <WorldSidePanel
            agents={summaries}
            selectedId={selectedId}
            tab={tab}
            onTabChange={setTab}
            onSelect={select}
            onOpenInspector={setInspectedId}
            onPause={(id) => dispatch({ type: "pause", id })}
            onResume={(id) => dispatch({ type: "resume", id })}
            onDelete={deleteAgent}
            onRename={(id, name) => dispatch({ type: "rename", id, name })}
            onMoveToZone={(id, zone) => dispatch({ type: "moveToZone", id, zone })}
          />
        </div>
      </div>

      <CreateAgentDialog
        open={creating}
        defaultName={t("defaultName", { n: sandbox.length + 1 })}
        onCreate={createAgent}
        onCancel={() => setCreating(false)}
      />
      <ConfirmModal
        open={confirmClear}
        title={t("clearTitle")}
        message={t("clearConfirm")}
        confirmLabel={t("clear")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          dispatch({ type: "clear" });
          setConfirmClear(false);
          setSelectedId((id) => (id?.startsWith("sbx-") ? null : id));
        }}
        onCancel={() => setConfirmClear(false)}
      />
      <AgentInspectorDrawer
        agent={inspectedAgent}
        session={inspectedAgent ? (sessionsById.get(inspectedAgent.session_id) ?? null) : null}
        onClose={() => setInspectedId(null)}
        onAgentUpdated={() => void loadAgents().catch(() => {})}
      />
    </div>
  );
}
