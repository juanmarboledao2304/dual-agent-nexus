/**
 * @file useQuotaTelemetry.ts
 * @description Shared, app-wide store for the dual-quota telemetry (Claude Direct 5h window, Antigravity
 * pools, agy-cascade waterfall status). One 6-second poll plus WebSocket pushes feed every consumer (the
 * top-bar meter, the Home quota card, the Usage page) instead of each component polling on its own. The
 * poll only runs while at least one component is subscribed, and keeps the last good value when the
 * server is briefly unreachable. {@link summarizeClaudeWindow} prefers the real subscription limits the
 * Nexus statusline forwards (source "statusline") and falls back to the token-count estimate.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import type { CascadeStatus, DualQuotaTelemetry, WSMessage } from "./types";

/** Snapshot every subscriber reads. */
export interface QuotaSnapshot {
  quota: DualQuotaTelemetry | null;
  cascade: CascadeStatus | null;
  /** True while a swarm simulation is running on the server. */
  simulating: boolean;
}

const POLL_MS = 6000;

let snapshot: QuotaSnapshot = { quota: null, cascade: null, simulating: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribeBus: (() => void) | null = null;

/** Replace the snapshot and notify subscribers. */
function publish(next: Partial<QuotaSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

/** Fetch the latest telemetry; failures keep the previous value. */
export async function refreshQuota(): Promise<void> {
  try {
    const data = await api.quota.get();
    publish({
      quota: data,
      cascade: data.cascade ?? snapshot.cascade,
      simulating: data.simulating,
    });
  } catch {
    // Keep the last good telemetry while the server is unreachable.
  }
}

/** Start polling and listening when the first subscriber arrives. */
function start(): void {
  void refreshQuota();
  timer = setInterval(() => void refreshQuota(), POLL_MS);
  unsubscribeBus = eventBus.subscribe((msg: WSMessage) => {
    if (msg.type === "quota_updated" && msg.data) {
      const q = msg.data as DualQuotaTelemetry;
      publish({ quota: q, cascade: q.cascade ?? snapshot.cascade, simulating: q.simulating });
    } else if (msg.type === "cascade:status" && msg.data) {
      publish({ cascade: msg.data as CascadeStatus });
    } else if (msg.type === "swarm_simulation_started") {
      publish({ simulating: true });
    } else if (msg.type === "swarm_simulation_completed") {
      publish({ simulating: false });
      void refreshQuota();
    }
  });
}

/** Stop polling once the last subscriber leaves. */
function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  unsubscribeBus?.();
  unsubscribeBus = null;
}

/** useSyncExternalStore subscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Current snapshot (stable identity between publishes). */
function getSnapshot(): QuotaSnapshot {
  return snapshot;
}

/**
 * Subscribe a component to the shared quota telemetry.
 *
 * @returns The latest snapshot; `quota` is null until the first successful fetch.
 */
export function useQuotaTelemetry(): QuotaSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Claude Direct figures derived for display. */
export interface ClaudeWindowSummary {
  used: number;
  cap: number;
  /** Fraction of the 5h window still free, 0..1. */
  freeFraction: number;
  /** Hours until the window is full at the current burn, or null when idle/unknown. */
  hoursToEmpty: number | null;
  burnPerHour: number;
  cacheEfficiencyPct: number;
  /** "statusline" when the numbers are Claude's real limits, "estimate" for the token-count guess. */
  source: "statusline" | "estimate";
  /** Hours until the 5-hour window resets (real limits only). */
  resetsInHours: number | null;
  /** Percent of the 7-day limit used (real limits only). */
  weeklyUsedPct: number | null;
  /** Hours until the 7-day limit resets (real limits only). */
  weeklyResetsInHours: number | null;
}

/** Hours from `now` until an epoch-seconds instant, never negative. */
function hoursUntil(epochSeconds: number, now: number): number {
  return Math.max(0, (epochSeconds * 1000 - now) / 3_600_000);
}

/**
 * Summarize the Claude Direct 5-hour window.
 *
 * @param quota - Telemetry, or null before the first fetch.
 * @returns Summary, or null when there is no telemetry yet.
 */
export function summarizeClaudeWindow(
  quota: DualQuotaTelemetry | null,
  now: number = Date.now()
): ClaudeWindowSummary | null {
  if (!quota) return null;
  const { window_5h_tokens: used, window_5h_cap: cap } = quota.claude;
  const limits = quota.claude.rate_limits ?? null;
  const fiveHour = limits?.five_hour;
  const sevenDay = limits?.seven_day;
  const weekly = {
    weeklyUsedPct: sevenDay ? sevenDay.used_percentage : null,
    weeklyResetsInHours: sevenDay ? hoursUntil(sevenDay.resets_at, now) : null,
  };
  if (fiveHour) {
    return {
      used,
      cap,
      freeFraction: Math.max(0, Math.min(1, 1 - fiveHour.used_percentage / 100)),
      // Claude reports how much is used, not how fast it burns: no time-to-empty guess.
      hoursToEmpty: null,
      burnPerHour: quota.claude.burn_rate_tokens_per_hr,
      cacheEfficiencyPct: quota.claude.cache_efficiency_pct,
      source: "statusline",
      resetsInHours: hoursUntil(fiveHour.resets_at, now),
      ...weekly,
    };
  }
  const freeFraction = cap > 0 ? Math.max(0, Math.min(1, 1 - used / cap)) : 1;
  return {
    used,
    cap,
    freeFraction,
    hoursToEmpty: quota.claude.est_hours_to_cap,
    burnPerHour: quota.claude.burn_rate_tokens_per_hr,
    cacheEfficiencyPct: quota.claude.cache_efficiency_pct,
    source: "estimate",
    resetsInHours: null,
    ...weekly,
  };
}

/** Severity of a remaining-quota fraction: drives meter colour and the Needs-you rule. */
export type QuotaTone = "ok" | "low" | "critical";

/**
 * Classify how much quota is left.
 *
 * @param freeFraction - Fraction free, 0..1.
 * @returns "critical" under 10%, "low" under 20%, otherwise "ok".
 */
export function quotaTone(freeFraction: number): QuotaTone {
  if (freeFraction < 0.1) return "critical";
  if (freeFraction < 0.2) return "low";
  return "ok";
}

/**
 * Compact token count: 709900 -> "709.9K", 2500000 -> "2.50M".
 *
 * @param n - Token count.
 * @returns Short label.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * Hours as "12h 36m" (or "42m" under an hour).
 *
 * @param hours - Duration in hours.
 * @returns Short label.
 */
export function formatHours(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
