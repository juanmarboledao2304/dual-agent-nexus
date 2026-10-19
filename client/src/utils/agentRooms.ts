/**
 * @file agentRooms.ts
 * @description Pure layout and attention logic for the DualAgent Nexus Agent Rooms page. Assigns
 * every agent a hierarchy level (L1 conductor, L2 cascade worker, L3 fan-out unit) and one of
 * four spatial zones (Conductor Bridge, Cascade Engine Room, Specialist Fan-Out Pods, Completed
 * Digest Vault); keeps a bounded per-agent trace buffer for the pods' mini-terminals; and runs
 * the Attention Radar checks (blocked on a y/n approval, Exit Code 10 quota exhaustion, and the
 * same tool executed four or more consecutive times).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { parseAgentMetadata } from "./agentTheme";
import { isAwaitingApproval, toolBadgeLabel } from "./pixelSprites";
import type { Agent, DashboardEvent } from "../lib/types";

/** The four Agent Rooms zones, in floor-plan order. */
export type RoomZoneId = "conductor" | "engine" | "fanout" | "vault";

/** Static description of one zone. */
export interface RoomZoneDefinition {
  id: RoomZoneId;
  code: string;
  title: string;
  subtitle: string;
}

export const ROOM_ZONES: readonly RoomZoneDefinition[] = [
  {
    id: "conductor",
    code: "ZONE 01",
    title: "Conductor Bridge",
    subtitle: "Level 1 · Claude Direct conductors and top-level orchestrators",
  },
  {
    id: "engine",
    code: "ZONE 02",
    title: "Cascade Engine Room",
    subtitle: "Level 2 · agy-cascade active pool workers and delegated subagents",
  },
  {
    id: "fanout",
    code: "ZONE 03",
    title: "Specialist Fan-Out Pods",
    subtitle: "Level 3 · parallel invoke_subagent units",
  },
  {
    id: "vault",
    code: "ZONE 04",
    title: "Completed Digest Vault",
    subtitle: "===DIGEST=== handoffs and git checkpoints",
  },
] as const;

/** Consecutive identical tool calls that trip the loop detector. */
export const LOOP_THRESHOLD = 4;
/** Trace lines kept per agent; pods show the last three. */
export const TRACE_CAPACITY = 24;
/** Tool calls kept per agent for loop detection. */
const TOOL_HISTORY_CAPACITY = 16;

/**
 * Resolve an agent's level in the 3-level cascade hierarchy. Main agents are L1. Subagents use
 * an explicit `hierarchy_level` from metadata when present; otherwise a subagent whose parent is
 * itself a subagent is L3, and every other subagent is L2.
 *
 * @param agent - Agent to place.
 * @param byId - Every known agent by id, for parent lookups.
 * @returns 1, 2, or 3.
 */
export function resolveAgentLevel(agent: Agent, byId: Map<string, Agent>): 1 | 2 | 3 {
  if (agent.type === "main") return 1;
  const level = parseAgentMetadata(agent.metadata).hierarchy_level;
  if (level === 2 || level === 3) return level;
  const parent = agent.parent_agent_id ? byId.get(agent.parent_agent_id) : undefined;
  return parent && parent.type === "subagent" ? 3 : 2;
}

/**
 * Pick the zone for an agent: completed agents move to the Digest Vault, everything else stays
 * in its level's room (including errored agents, which the Attention Radar keeps visible).
 *
 * @param agent - Agent to place.
 * @param level - Its hierarchy level.
 * @returns The zone id.
 */
export function assignRoomZone(agent: Agent, level: 1 | 2 | 3): RoomZoneId {
  if (agent.status === "completed") return "vault";
  if (level === 1) return "conductor";
  if (level === 2) return "engine";
  return "fanout";
}

/** Agents grouped into zones, plus each agent's resolved level. */
export interface RoomLayout {
  zones: Record<RoomZoneId, Agent[]>;
  levelById: Map<string, 1 | 2 | 3>;
}

function activityTs(agent: Agent): number {
  const raw = agent.ended_at || agent.last_activity || agent.updated_at || agent.started_at;
  const ts = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Lay agents out across the four zones. Active rooms list working agents first, then by most
 * recent activity; the vault lists the most recently finished first.
 *
 * @param agents - Agents to lay out (one row per id).
 * @returns Zones and levels.
 */
export function buildRoomLayout(agents: Agent[]): RoomLayout {
  const byId = new Map(agents.map((a) => [a.id, a] as const));
  const zones: Record<RoomZoneId, Agent[]> = { conductor: [], engine: [], fanout: [], vault: [] };
  const levelById = new Map<string, 1 | 2 | 3>();
  for (const agent of agents) {
    const level = resolveAgentLevel(agent, byId);
    levelById.set(agent.id, level);
    zones[assignRoomZone(agent, level)].push(agent);
  }
  const activeOrder = (a: Agent, b: Agent) => {
    const aw = a.status === "working" ? 1 : 0;
    const bw = b.status === "working" ? 1 : 0;
    return bw - aw || activityTs(b) - activityTs(a);
  };
  zones.conductor.sort(activeOrder);
  zones.engine.sort(activeOrder);
  zones.fanout.sort(activeOrder);
  zones.vault.sort((a, b) => activityTs(b) - activityTs(a));
  return { zones, levelById };
}

/** One line in an agent's mini-terminal. */
export interface TraceLine {
  /** Monotonic key within the buffer. */
  seq: number;
  /** HH:MM:SS timestamp. */
  time: string;
  /** Tool or event label, e.g. `BASH`, `STDOUT`. */
  label: string;
  text: string;
  stream: "tool" | "stdout" | "stderr" | "event";
}

/** Per-agent rolling traces and tool histories. */
export interface TraceStore {
  lines: Map<string, TraceLine[]>;
  tools: Map<string, string[]>;
  seq: number;
}

export function createTraceStore(): TraceStore {
  return { lines: new Map(), tools: new Map(), seq: 0 };
}

function clockTime(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const safe = Number.isFinite(d.getTime()) ? d : new Date();
  return safe.toTimeString().slice(0, 8);
}

/** Short terminal labels for lifecycle hook events that carry no tool. */
const EVENT_LABELS: Record<string, string> = {
  UserPromptSubmit: "PROMPT",
  SessionStart: "START",
  SessionEnd: "END",
  Stop: "STOP",
  SubagentStart: "SUB-START",
  SubagentStop: "SUB-DONE",
  Notification: "NOTIFY",
  Compaction: "COMPACT",
  PreCompact: "COMPACT",
  APIError: "ERROR",
  TurnDuration: "TURN",
};

/**
 * Terminal label for a tool-less hook event.
 *
 * @param eventType - Hook event name.
 * @returns A short uppercase label.
 */
export function eventLabel(eventType: string): string {
  return (
    EVENT_LABELS[eventType] ??
    eventType
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase()
      .slice(0, 8)
  );
}

function pushLine(store: TraceStore, agentId: string, line: Omit<TraceLine, "seq">): void {
  store.seq += 1;
  const list = store.lines.get(agentId) ?? [];
  list.push({ ...line, seq: store.seq });
  if (list.length > TRACE_CAPACITY) list.splice(0, list.length - TRACE_CAPACITY);
  store.lines.set(agentId, list);
}

/**
 * Record a hook event in its agent's trace. Tool calls (PreToolUse) also extend the agent's tool
 * history for loop detection.
 *
 * @param store - Trace store to mutate.
 * @param event - Hook event row or `new_event` payload.
 * @param fallbackAgentId - Agent to attribute session-level events (no `agent_id`) to.
 * @returns True when the event was recorded.
 */
export function recordEventTrace(
  store: TraceStore,
  event: Pick<DashboardEvent, "agent_id" | "event_type" | "tool_name" | "summary" | "created_at">,
  fallbackAgentId?: string | null
): boolean {
  const agentId = event.agent_id || fallbackAgentId;
  if (!agentId) return false;
  const tool = event.tool_name ? String(event.tool_name) : null;
  if (event.event_type === "PreToolUse" && tool) {
    const tools = store.tools.get(agentId) ?? [];
    tools.push(tool);
    if (tools.length > TOOL_HISTORY_CAPACITY) tools.splice(0, tools.length - TOOL_HISTORY_CAPACITY);
    store.tools.set(agentId, tools);
  }
  pushLine(store, agentId, {
    time: clockTime(event.created_at),
    label: tool ? (toolBadgeLabel(tool) ?? "TOOL") : eventLabel(event.event_type),
    text: (event.summary || event.event_type).replace(/\s+/g, " ").trim(),
    stream: tool ? "tool" : "event",
  });
  return true;
}

/**
 * Record a live process output line (`dispatch_stream`) in its agent's trace.
 *
 * @param store - Trace store to mutate.
 * @param agentId - Agent the output belongs to.
 * @param text - Raw output; blank lines are dropped.
 * @param stream - Which pipe it came from.
 * @returns True when a line was recorded.
 */
export function recordStreamTrace(
  store: TraceStore,
  agentId: string | null | undefined,
  text: unknown,
  stream: "stdout" | "stderr" = "stdout"
): boolean {
  if (!agentId) return false;
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean === "undefined") return false;
  pushLine(store, agentId, {
    time: clockTime(),
    label: stream.toUpperCase(),
    text: clean,
    stream,
  });
  return true;
}

/** A detected tool loop: the same tool run `count` times in a row. */
export interface ToolLoop {
  tool: string;
  count: number;
}

/**
 * Detect a run of identical tool calls at the tail of an agent's tool history.
 *
 * @param tools - Tool names in call order.
 * @param threshold - Minimum run length that counts as a loop.
 * @returns The loop, or null when the tail run is shorter than the threshold.
 */
export function detectToolLoop(
  tools: readonly string[] | undefined,
  threshold = LOOP_THRESHOLD
): ToolLoop | null {
  const last = tools?.[tools.length - 1];
  if (!tools || last === undefined || tools.length < threshold) return null;
  let count = 0;
  for (let i = tools.length - 1; i >= 0 && tools[i] === last; i -= 1) count += 1;
  return count >= threshold ? { tool: last, count } : null;
}

/** Attention Radar flags for one pod. */
export interface AttentionFlags {
  approval: boolean;
  quotaExhausted: boolean;
  loop: ToolLoop | null;
  error: boolean;
}

/**
 * Run the Attention Radar checks for an agent. Finished agents never raise flags.
 *
 * @param agent - Agent to check.
 * @param tools - Its recent tool history.
 * @returns Flags; `hasAttention` is true when any is raised.
 */
export function detectAttention(
  agent: Agent,
  tools?: readonly string[]
): AttentionFlags & { hasAttention: boolean } {
  const finished = agent.status === "completed";
  const meta = parseAgentMetadata(agent.metadata) as ReturnType<typeof parseAgentMetadata> & {
    exit_code_10_handled?: boolean;
  };
  const flags: AttentionFlags = {
    approval: !finished && isAwaitingApproval(agent),
    quotaExhausted:
      !finished &&
      (meta.cascade_exit_code === 10 ||
        meta.exit_code_10_handled === true ||
        !!meta.exhausted_pool),
    loop: finished ? null : detectToolLoop(tools),
    error: agent.status === "error",
  };
  return {
    ...flags,
    hasAttention: flags.approval || flags.quotaExhausted || flags.loop !== null || flags.error,
  };
}
