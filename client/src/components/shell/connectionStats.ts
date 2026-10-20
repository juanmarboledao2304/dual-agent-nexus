/**
 * @file connectionStats.ts
 * @description Hooks behind the top navigation's live-connection pill and update
 * check: ref-based WebSocket traffic statistics persisted to localStorage (so live
 * traffic never re-renders the navigation) and the manual / palette-triggered
 * update check. Moved from the former Sidebar component.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { api } from "../../lib/api";
import { eventBus } from "../../lib/eventBus";
import { UPDATE_CHECK_EVENT } from "../../lib/appEvents";
import type { UpdateStatusPayload, WSMessage } from "../../lib/types";

/** localStorage key for the persisted connection statistics. */
export const STATS_STORAGE_KEY = "sidebar-connection-stats";
/** Number of recent events kept for the activity list. */
const RECENT_EVENTS_CAP = 8;

/**
 * Type guard for an `update_status` WebSocket payload.
 *
 * @param x - Message data.
 * @returns True when it carries the `git_repo` and `update_available` fields.
 */
function isUpdatePayload(x: unknown): x is UpdateStatusPayload {
  return !!x && typeof x === "object" && "git_repo" in x && "update_available" in x;
}

/**
 * Connection statistics persisted to localStorage. The rolling one-minute event buffer behind the
 * sparkline is deliberately not persisted, since it is only meaningful relative to now.
 */
interface PersistedStats {
  eventCount: number;
  peakPerSec: number;
  lastEvent: { type: string; at: number } | null;
  typeCount: [string, number][];
  recentEvents: { type: string; at: number }[];
}

/**
 * Read persisted connection statistics, validating each field so a corrupt or outdated entry cannot
 * break the navigation.
 *
 * @returns The stored statistics, or zeroed statistics when nothing valid is stored.
 */
function loadStats(): PersistedStats {
  const empty: PersistedStats = {
    eventCount: 0,
    peakPerSec: 0,
    lastEvent: null,
    typeCount: [],
    recentEvents: [],
  };
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PersistedStats>;
    return {
      eventCount: typeof parsed.eventCount === "number" ? parsed.eventCount : 0,
      peakPerSec: typeof parsed.peakPerSec === "number" ? parsed.peakPerSec : 0,
      lastEvent:
        parsed.lastEvent &&
        typeof parsed.lastEvent.type === "string" &&
        typeof parsed.lastEvent.at === "number"
          ? parsed.lastEvent
          : null,
      typeCount: Array.isArray(parsed.typeCount)
        ? parsed.typeCount.filter(
            (e): e is [string, number] =>
              Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number"
          )
        : [],
      recentEvents: Array.isArray(parsed.recentEvents)
        ? parsed.recentEvents
            .filter(
              (e): e is { type: string; at: number } =>
                !!e && typeof e.type === "string" && typeof e.at === "number"
            )
            .slice(0, RECENT_EVENTS_CAP)
        : [],
    };
  } catch {
    return empty;
  }
}

/** Ref buffers the connection modal samples on its own timer. */
export interface ConnectionStatsRefs {
  eventCountRef: MutableRefObject<number>;
  peakPerSecRef: MutableRefObject<number>;
  lastEventRef: MutableRefObject<{ type: string; at: number } | null>;
  eventTimestampsRef: MutableRefObject<number[]>;
  typeCountRef: MutableRefObject<Map<string, number>>;
  recentEventsRef: MutableRefObject<Array<{ type: string; at: number }>>;
}

/**
 * Count every WebSocket message into ref buffers. Cumulative counters are hydrated from and written
 * to localStorage at most every 2 seconds, and flushed when the page is hidden.
 *
 * @param wsConnected - Live WebSocket state, used for the honest "connected since" timestamp.
 * @returns The ref buffers, the connection start time, and a reset that also clears storage.
 */
export function useConnectionStats(
  wsConnected: boolean
): ConnectionStatsRefs & { connectedSince: number | null; resetStats: () => void } {
  const [connectedSince, setConnectedSince] = useState<number | null>(
    wsConnected ? Date.now() : null
  );
  const eventCountRef = useRef(0);
  const peakPerSecRef = useRef(0);
  const lastEventRef = useRef<{ type: string; at: number } | null>(null);
  const eventTimestampsRef = useRef<number[]>([]);
  const typeCountRef = useRef<Map<string, number>>(new Map());
  const recentEventsRef = useRef<Array<{ type: string; at: number }>>([]);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stats = loadStats();
    eventCountRef.current = stats.eventCount;
    peakPerSecRef.current = stats.peakPerSec;
    lastEventRef.current = stats.lastEvent;
    typeCountRef.current = new Map(stats.typeCount);
    recentEventsRef.current = stats.recentEvents;
  }, []);

  /** Write the cumulative connection statistics to localStorage. Storage failures are ignored. */
  const persistStats = useCallback(() => {
    try {
      const payload: PersistedStats = {
        eventCount: eventCountRef.current,
        peakPerSec: peakPerSecRef.current,
        lastEvent: lastEventRef.current,
        typeCount: Array.from(typeCountRef.current.entries()),
        recentEvents: recentEventsRef.current,
      };
      localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota / disabled storage */
    }
  }, []);

  /** Persist the statistics at most once every 2 seconds. */
  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) return;
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistStats();
    }, 2000);
  }, [persistStats]);

  useEffect(() => {
    /** Write any pending statistics immediately, used when the page is hidden or unloaded. */
    const flush = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistStats();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [persistStats]);

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "update_status") return;
      const now = Date.now();
      eventCountRef.current += 1;
      lastEventRef.current = { type: msg.type, at: now };
      eventTimestampsRef.current.push(now);
      // Keep only the last 60 seconds worth of timestamps for the sparkline.
      const cutoff = now - 60_000;
      const stamps = eventTimestampsRef.current;
      while (stamps.length > 0 && (stamps[0] as number) < cutoff) {
        stamps.shift();
      }
      typeCountRef.current.set(msg.type, (typeCountRef.current.get(msg.type) ?? 0) + 1);
      recentEventsRef.current.unshift({ type: msg.type, at: now });
      if (recentEventsRef.current.length > RECENT_EVENTS_CAP) {
        recentEventsRef.current.length = RECENT_EVENTS_CAP;
      }
      // All-time peak events/sec: count events in the trailing 1s window, walking back from the
      // newest timestamp and stopping at the threshold so bursts stay O(k).
      const oneSecAgo = now - 1000;
      let inLastSec = 0;
      for (let i = stamps.length - 1; i >= 0; i--) {
        if ((stamps[i] as number) >= oneSecAgo) inLastSec += 1;
        else break;
      }
      if (inLastSec > peakPerSecRef.current) {
        peakPerSecRef.current = inLastSec;
      }
      schedulePersist();
    });
  }, [schedulePersist]);

  useEffect(() => {
    if (wsConnected) {
      setConnectedSince((prev) => prev ?? Date.now());
    } else {
      setConnectedSince(null);
    }
  }, [wsConnected]);

  const resetStats = useCallback(() => {
    eventCountRef.current = 0;
    peakPerSecRef.current = 0;
    lastEventRef.current = null;
    eventTimestampsRef.current = [];
    typeCountRef.current = new Map();
    recentEventsRef.current = [];
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    try {
      localStorage.removeItem(STATS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    connectedSince,
    resetStats,
    eventCountRef,
    peakPerSecRef,
    lastEventRef,
    eventTimestampsRef,
    typeCountRef,
    recentEventsRef,
  };
}

/**
 * Track the server's update status and run checks on request (from the navigation or from the
 * command palette via {@link UPDATE_CHECK_EVENT}). A manual check clears any earlier dismissal of
 * the update notice so it can show again.
 *
 * @returns The latest status, whether a check is running or failed, and the check trigger.
 */
export function useUpdateCheck(): {
  status: UpdateStatusPayload | null;
  checking: boolean;
  checkError: boolean;
  check: () => Promise<void>;
} {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const checkingRef = useRef(false);

  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "update_status" && isUpdatePayload(msg.data)) {
        setStatus(msg.data);
        setCheckError(Boolean(msg.data.fetch_error));
      }
    });
  }, []);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setCheckError(false);
    try {
      localStorage.removeItem("agent-monitor-update-dismissed-sha");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("dashboard:reset-update-dismissal"));
    try {
      const fresh = await api.updates.check();
      setStatus(fresh);
      setCheckError(Boolean(fresh.fetch_error));
    } catch {
      setCheckError(true);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    /** Run the update check when the command palette asks for one. */
    const onRequest = () => {
      void check();
    };
    window.addEventListener(UPDATE_CHECK_EVENT, onRequest);
    return () => window.removeEventListener(UPDATE_CHECK_EVENT, onRequest);
  }, [check]);

  return { status, checking, checkError, check };
}
