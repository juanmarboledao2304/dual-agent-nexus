/**
 * @file ConnectionStatusModal.tsx
 * @description Live-connection diagnostics modal opened from the top navigation's
 * status pill: WebSocket endpoint and uptime, event KPIs, a one-minute throughput
 * sparkline, top event types, and recent activity. Moved from the former Sidebar
 * component.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Wifi, WifiOff, X, Plug, Clock, Gauge, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Props for {@link ConnectionStatusModal}. The statistics are passed as refs owned by
 * {@link useConnectionStats}, so the modal samples them on its own timer instead of
 * re-rendering the navigation.
 */
export interface ConnectionStatusModalProps {
  /** Whether the modal is shown. */
  open: boolean;
  /** Closes the modal. */
  onClose: () => void;
  /** Live WebSocket state. */
  wsConnected: boolean;
  /** Epoch milliseconds when the current connection came up, or null while disconnected. */
  connectedSince: number | null;
  /** Total events received. */
  eventCountRef: React.MutableRefObject<number>;
  /** Highest events-per-second rate seen. */
  peakPerSecRef: React.MutableRefObject<number>;
  /** Most recent event, or null. */
  lastEventRef: React.MutableRefObject<{ type: string; at: number } | null>;
  /** Arrival times of recent events, used for the one-minute sparkline. */
  eventTimestampsRef: React.MutableRefObject<number[]>;
  /** Event counts per message type. */
  typeCountRef: React.MutableRefObject<Map<string, number>>;
  /** Most recent events for the activity list. */
  recentEventsRef: React.MutableRefObject<Array<{ type: string; at: number }>>;
  /** Clears every statistic, including the persisted copy. */
  onResetStats: () => void;
}

/**
 * Connection status modal: connection state, WebSocket endpoint, and uptime; KPIs for total events,
 * events in the last minute, and peak rate; a one-minute events-per-second sparkline; the top event
 * types; and recent activity, with a reset button. It re-renders once a second while open so rates
 * and relative times stay current, stops ticking when closed, and closes on Escape.
 */
export function ConnectionStatusModal({
  open,
  onClose,
  wsConnected,
  connectedSince,
  eventCountRef,
  peakPerSecRef,
  lastEventRef,
  eventTimestampsRef,
  typeCountRef,
  recentEventsRef,
  onResetStats,
}: ConnectionStatusModalProps) {
  const { t } = useTranslation();
  const [, forceTick] = useState(0);

  // Re-render once a second so the sparkline / relative timestamps / counts
  // stay honest while the modal is open. Cleared on close so we don't burn
  // cycles in the background.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    /** Close the modal on Escape. */
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  /** WebSocket endpoint for this page's origin, using `wss:` on HTTPS. */
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }, []);

  if (!open || typeof document === "undefined") return null;

  const eventCount = eventCountRef.current;
  const lastEvent = lastEventRef.current;
  const recentEvents = recentEventsRef.current;
  const buckets = bucketEventsPerSecond(eventTimestampsRef.current, 60);
  const eventsLastMinute = buckets.reduce((sum, n) => sum + n, 0);
  // All-time peak - kept persistently across the session and across reloads,
  // so a one-off burst doesn't disappear once it rolls off the 60s window.
  const peakPerSec = peakPerSecRef.current;
  const avgPerSec = eventsLastMinute / 60;

  const totalCounted = Array.from(typeCountRef.current.values()).reduce((sum, n) => sum + n, 0);
  const topTypes = Array.from(typeCountRef.current.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topMax = topTypes.length > 0 ? (topTypes[0] as [string, number])[1] : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-status-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-md card shadow-2xl animate-slide-up overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${
                wsConnected
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-surface-3 border-border text-gray-400"
              }`}
            >
              {wsConnected ? (
                <Wifi className="w-4 h-4" aria-hidden />
              ) : (
                <WifiOff className="w-4 h-4" aria-hidden />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="connection-status-title"
                className="text-base font-semibold text-gray-50 truncate tracking-tight leading-tight"
              >
                {t("nav:connectionDetails")}
              </h2>
              <p
                className={`text-[11px] font-medium inline-flex items-center gap-1.5 leading-tight ${
                  wsConnected ? "text-emerald-400" : "text-gray-500"
                }`}
              >
                {wsConnected && (
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                )}
                {wsConnected ? t("nav:live") : t("nav:disconnected")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("nav:close")}
            className="p-1.5 -m-1 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-surface-4 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 overflow-y-auto">
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-2">
            <KpiTile
              label={t("nav:eventsTotal")}
              value={eventCount.toLocaleString()}
              unit={t("nav:unitEvents")}
            />
            <KpiTile
              label={t("nav:eventsLastMin")}
              value={eventsLastMinute.toLocaleString()}
              unit={t("nav:unitEvents")}
            />
            <KpiTile
              label={t("nav:peakRate")}
              value={peakPerSec.toLocaleString()}
              unit={t("nav:unitPerSec")}
            />
          </div>

          {/* Throughput sparkline */}
          <Section title={t("nav:throughput60s")} icon={Gauge}>
            <Sparkline
              buckets={buckets}
              connected={wsConnected}
              avgLabel={`${avgPerSec.toFixed(2)}/s ${t("nav:avg")}`}
            />
          </Section>

          {/* Connection facts */}
          <Section title={t("nav:connection")} icon={Plug}>
            <div className="space-y-2">
              <DetailRow label={t("nav:wsEndpoint")} value={wsUrl} mono />
              <DetailRow
                label={t("nav:connectionUptime")}
                value={connectedSince ? formatRelative(connectedSince, t) : t("nav:notConnected")}
              />
              <DetailRow
                label={t("nav:lastEvent")}
                value={
                  lastEvent
                    ? `${lastEvent.type} · ${formatRelative(lastEvent.at, t)}`
                    : t("nav:noEventsYet")
                }
                mono={Boolean(lastEvent)}
              />
            </div>
          </Section>

          {/* Top event types */}
          <Section title={t("nav:topEventTypes")} icon={BarChart3}>
            {topTypes.length === 0 ? (
              <p className="text-xs text-gray-500 italic">{t("nav:noEventsYet")}</p>
            ) : (
              <div className="space-y-1.5">
                {topTypes.map(([type, count]) => (
                  <TypeBar key={type} type={type} count={count} max={topMax} total={totalCounted} />
                ))}
              </div>
            )}
          </Section>

          {/* Recent activity */}
          <Section title={t("nav:recentActivity")} icon={Clock}>
            {recentEvents.length === 0 ? (
              <p className="text-xs text-gray-500 italic">{t("nav:noEventsYet")}</p>
            ) : (
              <ul className="space-y-1">
                {recentEvents.map((evt, i) => (
                  <li
                    key={`${evt.at}-${i}`}
                    className="flex items-center justify-between gap-3 text-[11px] font-mono px-2 py-1 rounded bg-surface-2/50"
                  >
                    <span className="text-gray-200 truncate">{evt.type}</span>
                    <span className="text-gray-500 flex-shrink-0">{formatRelative(evt.at, t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-surface-2/40">
          <span className="text-[10px] text-gray-500">{t("nav:statsPersisted")}</span>
          <button
            type="button"
            onClick={onResetStats}
            className="text-[11px] font-medium text-gray-400 hover:text-gray-100 hover:bg-surface-3 px-2 py-1 rounded transition-colors"
          >
            {t("nav:resetStats")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Titled section inside the connection status modal. */
function Section({
  title,
  icon: Icon,
  children,
}: {
  /** Section heading. */
  title: string;
  /** Icon shown beside the heading. */
  icon: LucideIcon;
  /** Section content. */
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 pb-2 mb-3 border-b border-border/60">
        <span className="w-5 h-5 rounded-md bg-accent/15 border border-accent/25 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3 h-3 text-accent" aria-hidden />
        </span>
        <h3 className="text-[13px] font-semibold text-gray-100 tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** Small KPI tile with an uppercase label, a monospace value, and a unit. */
function KpiTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 truncate">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1 truncate">
        <span className="text-base font-semibold text-gray-100 font-mono">{value}</span>
        <span className="text-[10px] font-medium text-gray-500 truncate">{unit}</span>
      </div>
    </div>
  );
}

/** Label/value row in the connection details list, optionally monospace for ids and URLs. */
function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-gray-500 font-medium uppercase tracking-wider text-[10px] pt-0.5">
        {label}
      </span>
      <span className={`text-gray-200 text-right break-all min-w-0 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Horizontal bar for one event type in the breakdown. The bar is scaled against the busiest type
 * (with a 2% minimum so tiny counts stay visible), and the label shows the count and its share of
 * all events.
 */
function TypeBar({
  type,
  count,
  max,
  total,
}: {
  /** Event type. */
  type: string;
  /** Events of this type. */
  count: number;
  /** Count of the busiest type, which fills the bar. */
  max: number;
  /** Events of all types, for the share. */
  total: number;
}) {
  const widthPct = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  const sharePct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="text-[11px]">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="font-mono text-gray-200 truncate">{type}</span>
        <span className="text-gray-500 flex-shrink-0 font-mono">
          {count} · {sharePct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full bg-accent/70 rounded-full transition-[width] duration-300"
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * SVG sparkline of events per second over the last minute, with a filled area, scaled to the
 * busiest second. Drawn muted while disconnected.
 */
function Sparkline({
  buckets,
  connected,
  avgLabel,
}: {
  /** Events per second for each of the last 60 seconds, oldest first. */
  buckets: number[];
  /** Live WebSocket state; the line is drawn muted while disconnected. */
  connected: boolean;
  /** Localized label for the average rate. */
  avgLabel: string;
}) {
  const W = 320;
  const H = 56;
  const max = Math.max(1, ...buckets);
  const stepX = W / Math.max(1, buckets.length - 1);
  const points = buckets.map((v, i) => {
    const x = i * stepX;
    const y = H - (v / max) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = points.length > 0 ? `M ${points.join(" L ")}` : "";
  const areaPath = points.length > 0 ? `M 0,${H} L ${points.join(" L ")} L ${W},${H} Z` : "";
  const stroke = connected ? "#34d399" : "#6b7280";

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-14" aria-hidden>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {areaPath && <path d={areaPath} fill="url(#spark-fill)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-500 font-mono">
        <span>−60s</span>
        <span>{avgLabel}</span>
        <span>{"now"}</span>
      </div>
    </div>
  );
}

/**
 * Bucket event timestamps into per-second counts over a trailing window.
 *
 * @param timestamps - Event arrival times in epoch milliseconds.
 * @param windowSec - Window length in seconds.
 * @returns `windowSec` counts, oldest first, with the last bucket covering the current second.
 */
function bucketEventsPerSecond(timestamps: number[], windowSec: number): number[] {
  const now = Date.now();
  const buckets = new Array<number>(windowSec).fill(0);
  for (const ts of timestamps) {
    const ageSec = Math.floor((now - ts) / 1000);
    if (ageSec < 0 || ageSec >= windowSec) continue;
    // Index 0 = 60s ago, last index = now.
    const idx = windowSec - 1 - ageSec;
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Localized relative time such as `just now`, `12s ago`, `5m ago`, `3h ago`, or `2d ago`.
 *
 * @param timestamp - Epoch milliseconds.
 * @param t - Translation function.
 * @returns The relative time label.
 */
function formatRelative(
  timestamp: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSec < 5) return t("nav:justNow");
  if (diffSec < 60) return t("nav:secondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("nav:minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("nav:hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t("nav:daysAgo", { count: diffDay });
}
