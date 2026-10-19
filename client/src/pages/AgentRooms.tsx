/**
 * @file AgentRooms.tsx
 * @description Agent Rooms page (`/rooms`): the DualAgent Nexus spatial workstation grid. Agents
 * are laid out across four operational zones — Zone 01 Conductor Bridge (L1 Claude Direct),
 * Zone 02 Cascade Engine Room (L2 agy-cascade pool workers), Zone 03 Specialist Fan-Out Pods
 * (L3 invoke_subagent units), and Zone 04 Completed Digest Vault — as live workstation pods that
 * show the agent's 8-bit sprite, role, quota pool pill, model badge, 4-bar effort meter, a
 * mini-terminal with the last three trace lines, context utilization, token burn rate, and git
 * checkpoint count. An Attention Radar strip flags pods blocked on a y/n approval, hitting
 * Exit Code 10 (quota exhausted), or looping on the same tool four or more times. A layout
 * toggle switches to the classic status board (the former Kanban view) at `?layout=board`.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Archive,
  Building2,
  Columns3,
  GitCommit,
  LayoutGrid,
  Network,
  Radar,
  RefreshCw,
  Repeat,
  Server,
  ShieldAlert,
  ShieldCheck,
  OctagonAlert,
  Hand,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { useDataScope } from "../lib/dataScope";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { mergeFreshestById } from "../lib/merge-by-id";
import { KanbanBoard } from "./KanbanBoard";
import { PixelAvatar } from "../components/PixelAvatar";
import { EffortMeter, PoolPill } from "../components/NexusBadges";
import { AgentInspectorDrawer } from "../components/AgentInspectorDrawer";
import { CardSkeleton } from "../components/Skeleton";
import { getAgentThermalTheme, parseAgentMetadata, sanitizeAgentText } from "../utils/agentTheme";
import {
  ROOM_ZONES,
  buildRoomLayout,
  createTraceStore,
  detectAttention,
  recordEventTrace,
  recordStreamTrace,
} from "../utils/agentRooms";
import type { AttentionFlags, RoomZoneId, TraceLine } from "../utils/agentRooms";
import type { Agent, AgentStatus, DashboardEvent, Session, WSMessage } from "../lib/types";

/** Page layouts: the spatial rooms or the classic status board. */
const LAYOUTS = ["rooms", "board"] as const;
/** Agent statuses fetched for the rooms. */
const FETCH_STATUSES: AgentStatus[] = ["working", "waiting", "completed", "error"];
/** Completed agents fetched for the Digest Vault. */
const VAULT_FETCH_LIMIT = 60;
/** Recent hook events used to seed pod mini-terminals and loop detection. */
const TRACE_SEED_LIMIT = 300;
/** Pods shown per zone before "Show all". */
const ZONE_PAGE_SIZE = 9;

const ZONE_STYLE: Record<
  RoomZoneId,
  { icon: ComponentType<{ className?: string }>; accent: string; stripe: string }
> = {
  conductor: { icon: Building2, accent: "text-orange-300", stripe: "bg-orange-500" },
  engine: { icon: Server, accent: "text-fuchsia-300", stripe: "bg-fuchsia-500" },
  fanout: { icon: Network, accent: "text-emerald-300", stripe: "bg-emerald-500" },
  vault: { icon: Archive, accent: "text-cyan-300", stripe: "bg-cyan-500" },
};

const FLOOR_GRID_STYLE = {
  backgroundImage:
    "linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)",
  backgroundSize: "16px 16px",
};

/**
 * Agent Rooms route: a layout toggle above either the spatial rooms or the status board.
 *
 * @returns The page.
 */
export function AgentRooms() {
  const [layout, setLayout] = useUrlTab(LAYOUTS, "rooms", {
    param: "layout",
    storageKey: "agent-rooms-layout",
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100 tracking-tight">Agent Rooms</h1>
          <p className="text-xs text-slate-400">
            Spatial workstation grid for the 3-level agy-cascade hierarchy across all three quota
            pools.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Agent Rooms layout"
          className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={layout === "rooms"}
            onClick={() => setLayout("rooms")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              layout === "rooms"
                ? "bg-slate-800 text-slate-100 border border-slate-700"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Spatial Rooms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={layout === "board"}
            onClick={() => setLayout("board")}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              layout === "board"
                ? "bg-slate-800 text-slate-100 border border-slate-700"
                : "text-slate-400 hover:text-slate-200 border border-transparent"
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Status Board
          </button>
        </div>
      </div>

      {layout === "board" ? <KanbanBoard /> : <RoomsView />}
    </div>
  );
}

/**
 * The four-zone spatial grid with live pods, trace buffers, and the Attention Radar.
 *
 * @returns The rooms view.
 */
function RoomsView() {
  const [dataScope] = useDataScope();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspected, setInspected] = useState<Agent | null>(null);
  const [expandedZones, setExpandedZones] = useState<Partial<Record<RoomZoneId, boolean>>>({});
  const [, setTraceTick] = useState(0);
  const traceStore = useRef(createTraceStore());
  const mainBySession = useRef(new Map<string, string>());

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
    const merged = mergeFreshestById(...agentResults.map((r) => r.agents));
    const mains = new Map<string, string>();
    for (const a of merged) if (a.type === "main") mains.set(a.session_id, a.id);
    mainBySession.current = mains;
    setAgents(merged);
    setSessions(sessionsRes.sessions);
  }, [dataScope]);

  const seedTraces = useCallback(async () => {
    try {
      const res = await api.events.list({ limit: TRACE_SEED_LIMIT });
      const store = createTraceStore();
      const ordered = [...res.events].sort((a, b) => a.id - b.id);
      for (const ev of ordered) {
        recordEventTrace(store, ev, mainBySession.current.get(ev.session_id));
      }
      traceStore.current = store;
      setTraceTick((t) => t + 1);
    } catch {
      // Pods fall back to an empty terminal when history is unavailable.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAgents()
      .then(() => (cancelled ? undefined : seedTraces()))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAgents, seedTraces]);

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
        case "new_event": {
          const ev = msg.data as DashboardEvent;
          if (recordEventTrace(traceStore.current, ev, mainBySession.current.get(ev.session_id))) {
            setTraceTick((t) => t + 1);
          }
          break;
        }
        case "dispatch_stream": {
          const payload = (msg.data ?? {}) as Record<string, unknown>;
          const agentId = (payload.agent_id ?? payload.agentId) as string | undefined;
          const text = payload.line ?? payload.chunk ?? payload.text;
          const stream = payload.stream === "stderr" ? "stderr" : "stdout";
          if (recordStreamTrace(traceStore.current, agentId, text, stream)) {
            setTraceTick((t) => t + 1);
          }
          break;
        }
        default:
          break;
      }
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [loadAgents]);

  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  // Main agents of finished sessions are history, not live conductors.
  const roomAgents = useMemo(
    () =>
      agents.filter((a) => {
        if (a.type !== "main" || a.status === "completed") return true;
        const s = sessionsById.get(a.session_id);
        return !s || s.status === "active";
      }),
    [agents, sessionsById]
  );

  const layout = useMemo(() => buildRoomLayout(roomAgents), [roomAgents]);

  const attentionById = new Map<string, ReturnType<typeof detectAttention>>();
  for (const a of roomAgents) {
    attentionById.set(a.id, detectAttention(a, traceStore.current.tools.get(a.id)));
  }
  const flagged = roomAgents.filter((a) => attentionById.get(a.id)?.hasAttention);

  const refresh = () => {
    void loadAgents()
      .then(seedTraces)
      .catch(() => {});
  };

  return (
    <div className="space-y-4">
      <AttentionRadar
        flagged={flagged}
        attentionById={attentionById}
        onInspect={setInspected}
        onRefresh={refresh}
      />

      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {ROOM_ZONES.map((z) => (
            <CardSkeleton key={z.id} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="agent-rooms-grid">
          {ROOM_ZONES.map((zone) => {
            const list = layout.zones[zone.id];
            const showAll = expandedZones[zone.id] === true;
            const visible = showAll ? list : list.slice(0, ZONE_PAGE_SIZE);
            const style = ZONE_STYLE[zone.id];
            const Icon = style.icon;
            return (
              <section
                key={zone.id}
                aria-label={`${zone.code} ${zone.title}`}
                data-testid={`zone-${zone.id}`}
                className="relative rounded-xl border border-slate-800 bg-slate-950/80 overflow-hidden"
                style={FLOOR_GRID_STYLE}
              >
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${style.stripe}`} />
                <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-800/80 bg-slate-950/70">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-900 border border-slate-800">
                      <Icon className={`w-3.5 h-3.5 ${style.accent}`} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-xs font-bold tracking-wide text-slate-100 flex items-center gap-2">
                        <span className={`font-mono ${style.accent}`}>{zone.code}</span>
                        {zone.title}
                      </h2>
                      <p className="text-[10px] text-slate-500 truncate">{zone.subtitle}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                    {list.length} pod{list.length === 1 ? "" : "s"}
                  </span>
                </header>

                <div className="p-3">
                  {list.length === 0 ? (
                    <p className="text-[11px] font-mono text-slate-600 text-center py-8">
                      No agents in this zone. Run Swarm Simulation to populate the rooms.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                      {visible.map((agent) => (
                        <WorkstationPod
                          key={agent.id}
                          agent={agent}
                          session={sessionsById.get(agent.session_id)}
                          level={layout.levelById.get(agent.id) ?? 2}
                          trace={traceStore.current.lines.get(agent.id) ?? []}
                          attention={attentionById.get(agent.id)}
                          onInspect={setInspected}
                        />
                      ))}
                    </div>
                  )}
                  {list.length > ZONE_PAGE_SIZE && (
                    <button
                      type="button"
                      onClick={() => setExpandedZones((prev) => ({ ...prev, [zone.id]: !showAll }))}
                      className="mt-3 w-full text-[11px] font-mono text-slate-400 hover:text-slate-200 py-1.5 rounded-md border border-slate-800 bg-slate-900/80 hover:bg-slate-800 transition-colors"
                    >
                      {showAll ? "Show fewer" : `Show all ${list.length} pods`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <AgentInspectorDrawer
        agent={inspected}
        session={inspected ? sessionsById.get(inspected.session_id) : null}
        onClose={() => setInspected(null)}
        onAgentUpdated={refresh}
      />
    </div>
  );
}

/** Props for {@link AttentionRadar}. */
interface AttentionRadarProps {
  flagged: Agent[];
  attentionById: Map<string, AttentionFlags & { hasAttention: boolean }>;
  onInspect: (agent: Agent) => void;
  onRefresh: () => void;
}

/**
 * Attention Radar strip: counts per flag plus a chip for each flagged pod.
 *
 * @param props - See {@link AttentionRadarProps}.
 * @returns The strip.
 */
function AttentionRadar({ flagged, attentionById, onInspect, onRefresh }: AttentionRadarProps) {
  let approval = 0;
  let quota = 0;
  let loops = 0;
  let errors = 0;
  for (const a of flagged) {
    const f = attentionById.get(a.id);
    if (!f) continue;
    if (f.approval) approval += 1;
    if (f.quotaExhausted) quota += 1;
    if (f.loop) loops += 1;
    if (f.error) errors += 1;
  }
  const counters = [
    { label: "APPROVAL", count: approval, tone: "text-amber-300 border-amber-500/40" },
    { label: "EXIT 10", count: quota, tone: "text-red-300 border-red-500/40" },
    { label: "LOOP 4+", count: loops, tone: "text-fuchsia-300 border-fuchsia-500/40" },
    { label: "ERROR", count: errors, tone: "text-red-300 border-red-500/40" },
  ];

  return (
    <div
      data-testid="attention-radar"
      className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border ${
        flagged.length > 0
          ? "border-amber-500/40 bg-amber-950/20"
          : "border-slate-800 bg-slate-950/80"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-200">
        <Radar
          className={`w-3.5 h-3.5 ${flagged.length > 0 ? "text-amber-400" : "text-slate-500"}`}
        />
        Attention Radar
      </span>
      {counters.map((c) => (
        <span
          key={c.label}
          className={`px-1.5 py-0.5 rounded border font-mono text-[10px] ${
            c.count > 0 ? c.tone : "text-slate-600 border-slate-800"
          }`}
        >
          {c.label} {c.count}
        </span>
      ))}
      <span className="flex-1" />
      {flagged.length === 0 ? (
        <span className="text-[10px] font-mono text-slate-500">All pods nominal</span>
      ) : (
        flagged.slice(0, 6).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onInspect(a)}
            className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border border-amber-500/40 bg-slate-950 text-[10px] font-mono text-amber-200 hover:bg-slate-900"
          >
            <PixelAvatar agent={a} size={12} framed={false} indicator={false} showBadge={false} />
            <span className="truncate max-w-[10rem]">{sanitizeAgentText(a.name)}</span>
          </button>
        ))
      )}
      <button
        type="button"
        onClick={onRefresh}
        title="Reload rooms"
        aria-label="Reload rooms"
        className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Props for {@link WorkstationPod}. */
interface WorkstationPodProps {
  agent: Agent;
  session?: Session;
  level: 1 | 2 | 3;
  trace: TraceLine[];
  attention?: AttentionFlags & { hasAttention: boolean };
  onInspect: (agent: Agent) => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Tokens per hour: the server's burn rate when present, else lifetime average. */
function burnRatePerHour(agent: Agent): number {
  if (typeof agent.burn_rate_per_hour === "number" && agent.burn_rate_per_hour > 0) {
    return agent.burn_rate_per_hour;
  }
  const total = (agent.input_tokens ?? 0) + (agent.output_tokens ?? 0);
  const start = Date.parse(agent.started_at);
  const end = agent.ended_at ? Date.parse(agent.ended_at) : Date.now();
  const hours = Number.isFinite(start) ? Math.max((end - start) / 3_600_000, 1 / 60) : 0;
  return hours > 0 ? total / hours : 0;
}

const TRACE_TONE: Record<TraceLine["stream"], string> = {
  tool: "text-cyan-300",
  stdout: "text-emerald-300",
  stderr: "text-amber-300",
  event: "text-slate-400",
};

/**
 * One live workstation pod.
 *
 * @param props - See {@link WorkstationPodProps}.
 * @returns The pod card.
 */
function WorkstationPod({
  agent,
  session,
  level,
  trace,
  attention,
  onInspect,
}: WorkstationPodProps) {
  const theme = getAgentThermalTheme(agent, session?.provider, session?.model);
  const meta = parseAgentMetadata(agent.metadata);
  const role = level === 1 ? "Main" : sanitizeAgentText(agent.subagent_role || "") || theme.role;
  const name = sanitizeAgentText(level === 1 ? session?.name || agent.name : agent.name);
  const ctxPct = Math.min(100, Math.max(0, agent.context_utilization_pct ?? 0));
  const checkpoints = meta.git_checkpoints ?? meta.git_checkpoint_commits?.length ?? 0;
  const hasDigest = Boolean(meta.digest_received || meta.digest);
  const saved = meta.offloaded_tokens_saved ?? meta.digest?.offloaded_tokens_saved ?? 0;
  const lastLines = trace.slice(-3);

  const ring = attention?.approval
    ? "border-amber-400/80 shadow-[0_0_0_1px_rgba(251,191,36,0.5)]"
    : attention?.quotaExhausted || attention?.error
      ? "border-red-500/70 shadow-[0_0_0_1px_rgba(239,68,68,0.4)]"
      : attention?.loop
        ? "border-fuchsia-500/70 shadow-[0_0_0_1px_rgba(217,70,239,0.4)]"
        : theme.borderClass;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onInspect(agent)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect(agent);
        }
      }}
      data-testid="workstation-pod"
      data-agent-id={agent.id}
      className={`group cursor-pointer rounded-lg border bg-slate-950/95 p-2.5 space-y-2 min-w-0 transition-colors hover:bg-slate-900/95 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 ${ring}`}
    >
      {/* Identity: sprite, role, name, pool, model, effort */}
      <div className="flex items-start gap-2.5 min-w-0">
        <PixelAvatar agent={agent} session={session} size={40} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${theme.badgeClass}`}
            >
              {role}
            </span>
            <span className="text-[9px] font-mono text-slate-500 flex-shrink-0">L{level}</span>
            <span className="text-[11px] font-semibold text-slate-100 truncate" title={name}>
              {name}
            </span>
          </div>
          <PoolPill theme={theme} />
          <div className="flex items-center justify-between gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-200 border border-slate-700/80 truncate">
              {theme.modelShortName}
            </span>
            <EffortMeter theme={theme} />
          </div>
        </div>
      </div>

      {/* Attention flags */}
      {attention?.hasAttention && (
        <div className="flex flex-wrap items-center gap-1">
          {attention.approval && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-200 border border-amber-500/50">
              <Hand className="w-2.5 h-2.5" />
              WAITING y/n
            </span>
          )}
          {attention.quotaExhausted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/15 text-red-200 border border-red-500/50">
              <ShieldAlert className="w-2.5 h-2.5" />
              EXIT 10 QUOTA
              {meta.active_pool ? ` / ${String(meta.active_pool).toUpperCase()}` : ""}
            </span>
          )}
          {attention.loop && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/50">
              <Repeat className="w-2.5 h-2.5" />
              LOOP {attention.loop.tool.toUpperCase()} x{attention.loop.count}
            </span>
          )}
          {attention.error && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/15 text-red-200 border border-red-500/50">
              <OctagonAlert className="w-2.5 h-2.5" />
              ERROR
            </span>
          )}
        </div>
      )}

      {/* Embedded mini-terminal: last three trace lines */}
      <div
        className="rounded border border-slate-800 bg-black/80 px-2 py-1.5 font-mono text-[10px] leading-4 h-[3.75rem] overflow-hidden"
        data-testid="pod-terminal"
        aria-label="Recent output"
      >
        {lastLines.length === 0 ? (
          <p className="text-slate-600">
            $ awaiting output
            <span className="inline-block w-1.5 h-2.5 ml-0.5 align-middle bg-slate-600 animate-pulse-dot" />
          </p>
        ) : (
          lastLines.map((line) => (
            <p key={line.seq} className="truncate text-slate-300" title={line.text}>
              <span className="text-slate-600">{line.time}</span>{" "}
              <span className={TRACE_TONE[line.stream]}>{line.label}</span> {line.text}
            </p>
          ))
        )}
      </div>

      {/* Telemetry footer: context, burn rate, checkpoints, digest */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] font-mono text-slate-400">
          <span>CTX {ctxPct.toFixed(0)}%</span>
          <span>{fmtTokens(burnRatePerHour(agent))} tok/hr</span>
          <span
            className={`inline-flex items-center gap-0.5 ${checkpoints > 0 ? "text-cyan-300" : ""}`}
          >
            <GitCommit className="w-2.5 h-2.5" />
            {checkpoints}
          </span>
        </div>
        <div className="w-full h-1 bg-slate-900 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${theme.barActiveClass}`}
            style={{ width: `${Math.max(2, ctxPct)}%` }}
          />
        </div>
        {hasDigest && (
          <p className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-300">
            <ShieldCheck className="w-2.5 h-2.5" />
            ===DIGEST==={saved > 0 ? ` ${fmtTokens(saved)} tokens offloaded` : " received"}
          </p>
        )}
      </div>
    </div>
  );
}
