/**
 * @file useAttention.ts
 * @description The "Needs you" list: a shared, app-wide store of the few things that actually need the
 * human. The definition is strict on purpose so the signal never turns into wallpaper: an agent waiting
 * for tool approval, an agent whose pool hit its quota (agy-cascade exit 10), an agent stuck repeating
 * the same tool, an agent that errored in the last 30 minutes, an agent marked working with no event for
 * 10 minutes (stalled), and Claude Direct under 20% of its 5-hour window. The top-bar bell and the Home
 * strip read the same list. Agents are polled every 15 s and refreshed on agent WebSocket events.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import { mergeFreshestById } from "./merge-by-id";
import type { Agent, WSMessage } from "./types";
import { detectAttention } from "../utils/agentRooms";

/** Why an item needs the human. */
export type AttentionKind = "approval" | "quota" | "loop" | "error" | "stalled";

/** One agent-level attention item. */
export interface AttentionItem {
  kind: AttentionKind;
  agent: Agent;
  /** Minutes since the agent's last event (for "stalled"). */
  idleMinutes: number;
  /** Repeated tool and count (for "loop"). */
  loop?: { tool: string; count: number };
}

/** Order in which kinds are listed: the most blocking first. */
const KIND_ORDER: Record<AttentionKind, number> = {
  approval: 0,
  quota: 1,
  error: 2,
  loop: 3,
  stalled: 4,
};

/** Minutes without events before a working agent counts as stalled. */
export const STALL_MINUTES = 10;
/** Errors older than this no longer need the human. */
const ERROR_WINDOW_MINUTES = 30;
const POLL_MS = 15000;

/**
 * Classify agents into attention items. Pure: exported for tests.
 *
 * @param agents - Candidate agents (working, waiting, recent errors).
 * @param now - Current time in ms.
 * @returns Items, most blocking first, one per agent.
 */
export function classifyAttention(agents: readonly Agent[], now: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const agent of agents) {
    const updated = Date.parse(agent.updated_at);
    const idleMinutes = Number.isFinite(updated) ? Math.max(0, (now - updated) / 60000) : 0;
    const flags = detectAttention(agent);
    let kind: AttentionKind | null = null;
    if (flags.approval) kind = "approval";
    else if (flags.quotaExhausted) kind = "quota";
    else if (flags.error && idleMinutes <= ERROR_WINDOW_MINUTES) kind = "error";
    else if (flags.loop) kind = "loop";
    else if (agent.status === "working" && idleMinutes >= STALL_MINUTES) kind = "stalled";
    if (kind) {
      items.push({
        kind,
        agent,
        idleMinutes,
        loop: flags.loop ? { tool: flags.loop.tool, count: flags.loop.count } : undefined,
      });
    }
  }
  return items.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      Date.parse(b.agent.updated_at) - Date.parse(a.agent.updated_at)
  );
}

/** Snapshot every subscriber reads. */
export interface AttentionSnapshot {
  items: AttentionItem[];
  /** False until the first successful load. */
  loaded: boolean;
}

let snapshot: AttentionSnapshot = { items: [], loaded: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let unsubscribeBus: (() => void) | null = null;

/** Reload candidate agents and recompute the list; failures keep the previous list. */
export async function refreshAttention(): Promise<void> {
  try {
    const [working, waiting, errored] = await Promise.all([
      api.agents.list({ status: "working", limit: 100 }),
      api.agents.list({ status: "waiting", limit: 100, include_transient: true }),
      api.agents.list({ status: "error", limit: 20 }),
    ]);
    const agents = mergeFreshestById(working.agents, waiting.agents, errored.agents);
    snapshot = { items: classifyAttention(agents, Date.now()), loaded: true };
    for (const listener of listeners) listener();
  } catch {
    // Keep the previous list while the server is unreachable.
  }
}

function start(): void {
  void refreshAttention();
  timer = setInterval(() => void refreshAttention(), POLL_MS);
  unsubscribeBus = eventBus.subscribe((msg: WSMessage) => {
    if (msg.type === "agent_created" || msg.type === "agent_updated") {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refreshAttention(), 500);
    }
  });
}

function stop(): void {
  if (timer) clearInterval(timer);
  if (debounce) clearTimeout(debounce);
  timer = null;
  debounce = null;
  unsubscribeBus?.();
  unsubscribeBus = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): AttentionSnapshot {
  return snapshot;
}

/**
 * Subscribe a component to the shared Needs-you list.
 *
 * @returns The latest snapshot.
 */
export function useAttention(): AttentionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
