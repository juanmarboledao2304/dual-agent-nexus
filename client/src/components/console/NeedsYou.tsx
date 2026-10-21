/**
 * @file NeedsYou.tsx
 * @description "Needs you" surfaces: paper slips (the one inverted surface in the UI) for each item of
 * the shared attention list plus a Claude Direct low-quota slip, a top-bar bell with a count and a
 * popover list, and the Home strip that collapses to a single calm line when nothing needs the human.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bell,
  Check,
  Clock3,
  Fuel,
  Hand,
  MessageSquareReply,
  Repeat2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAttention } from "../../lib/useAttention";
import type { AttentionItem, AttentionKind } from "../../lib/useAttention";
import {
  formatHours,
  quotaTone,
  summarizeClaudeWindow,
  useQuotaTelemetry,
} from "../../lib/useQuotaTelemetry";
import { sanitizeAgentText } from "../../utils/agentTheme";
import { Popover } from "./Popover";

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  approval: Hand,
  input: MessageSquareReply,
  quota: Fuel,
  error: AlertTriangle,
  loop: Repeat2,
  stalled: Clock3,
};

/** Display name for an agent: its task when it has one, else its name. */
function agentTitle(item: AttentionItem): string {
  const text = sanitizeAgentText(item.agent.task || item.agent.name || "");
  return text || item.agent.name;
}

/** One paper slip. */
function Slip({
  icon: Icon,
  title,
  reason,
  to,
  action,
  onNavigate,
}: {
  icon: LucideIcon;
  title: string;
  reason: string;
  to: string;
  action: string;
  onNavigate?: () => void;
}) {
  return (
    <li className="paper-slip flex animate-slide-up items-center gap-3 px-3.5 py-2.5 motion-reduce:animate-none">
      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{reason}</p>
        <p className="truncate text-xs opacity-75">{title}</p>
      </div>
      <Link
        to={to}
        onClick={onNavigate}
        className="shrink-0 rounded-md border border-paper-ink/25 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-paper-ink/10"
      >
        {action}
      </Link>
    </li>
  );
}

/** Slip data for the Claude Direct quota, or null when it is fine. */
function useQuotaSlip() {
  const { t } = useTranslation("console");
  const { quota } = useQuotaTelemetry();
  const claude = summarizeClaudeWindow(quota);
  if (!claude || quotaTone(claude.freeFraction) === "ok") return null;
  return {
    reason: t("needsYou.quotaLow", { pct: Math.round(claude.freeFraction * 100) }),
    title:
      claude.hoursToEmpty != null
        ? t("needsYou.quotaLowDetail", { time: formatHours(claude.hoursToEmpty) })
        : t("pools.claudeDirect"),
  };
}

/**
 * Split attention items: stalled agents collapse into one summary slip (they are usually orphans of a
 * crashed or closed session, and one line per agent would bury the items that block real work).
 */
function useGroupedAttention() {
  const { items } = useAttention();
  const stalled = items.filter((i) => i.kind === "stalled");
  const blocking = items.filter((i) => i.kind !== "stalled");
  return { blocking, stalled };
}

/**
 * The slip list shared by the bell popover and the Home strip.
 *
 * @returns The list, or null when it is empty.
 */
function SlipList({ onNavigate, max }: { onNavigate?: () => void; max?: number }) {
  const { t } = useTranslation("console");
  const { blocking, stalled } = useGroupedAttention();
  const quotaSlip = useQuotaSlip();
  const shown = max ? blocking.slice(0, max) : blocking;
  if (!quotaSlip && blocking.length === 0 && stalled.length === 0) return null;
  const oldest = stalled.reduce((m, i) => Math.max(m, i.idleMinutes), 0);
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {quotaSlip && (
        <Slip
          icon={Fuel}
          reason={quotaSlip.reason}
          title={quotaSlip.title}
          to="/usage"
          action={t("needsYou.viewUsage")}
          onNavigate={onNavigate}
        />
      )}
      {shown.map((item) => (
        <Slip
          key={item.agent.id}
          icon={KIND_ICON[item.kind]}
          reason={t(`needsYou.kind.${item.kind}`, {
            minutes: Math.round(item.idleMinutes),
            tool: item.loop?.tool ?? "",
            count: item.loop?.count ?? 0,
          })}
          title={agentTitle(item)}
          to={`/sessions/${encodeURIComponent(item.agent.session_id)}`}
          action={t("needsYou.open")}
          onNavigate={onNavigate}
        />
      ))}
      {stalled.length === 1 && (
        <Slip
          icon={Clock3}
          reason={t("needsYou.kind.stalled", { minutes: Math.round(stalled[0]!.idleMinutes) })}
          title={agentTitle(stalled[0]!)}
          to={`/sessions/${encodeURIComponent(stalled[0]!.agent.session_id)}`}
          action={t("needsYou.open")}
          onNavigate={onNavigate}
        />
      )}
      {stalled.length > 1 && (
        <Slip
          icon={Clock3}
          reason={t("needsYou.stalledGroup", {
            count: stalled.length,
            minutes: Math.round(oldest),
          })}
          title={stalled.map(agentTitle).join(", ")}
          to="/agents?mode=timeline"
          action={t("needsYou.review")}
          onNavigate={onNavigate}
        />
      )}
    </ul>
  );
}

/**
 * Total count of things that need the human: blocking agents, one for any stalled group, and the
 * quota slip. Home's status line and the bell badge both use it.
 *
 * @returns The count.
 */
export function useNeedsYouCount(): number {
  const { blocking, stalled } = useGroupedAttention();
  return blocking.length + (stalled.length > 0 ? 1 : 0) + (useQuotaSlip() ? 1 : 0);
}

/**
 * Home strip: slips when something needs the human, one calm line otherwise.
 *
 * @returns The strip.
 */
export function NeedsYouStrip() {
  const { t } = useTranslation("console");
  const { loaded } = useAttention();
  const count = useNeedsYouCount();
  if (!loaded) return null;
  if (count === 0) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-gray-400">
        <Check className="h-4 w-4 text-mint-400" aria-hidden />
        {t("needsYou.allClear")}
      </p>
    );
  }
  return (
    <section aria-labelledby="needs-you-title">
      <h2 id="needs-you-title" className="mb-2 text-[13px] font-semibold text-gray-100">
        {t("needsYou.title", { count })}
      </h2>
      <SlipList max={6} />
    </section>
  );
}

/**
 * Top-bar bell with a count badge and the full list in a popover.
 *
 * @returns The bell.
 */
export function NeedsYouBell() {
  const { t } = useTranslation("console");
  const count = useNeedsYouCount();
  return (
    <Popover
      label={t("needsYou.bellLabel", { count })}
      widthClass="w-[420px]"
      triggerClassName="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-100"
      trigger={
        <>
          <Bell className="h-4 w-4" aria-hidden />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-paper px-1 text-[10px] font-bold tabular-nums text-paper-ink">
              {count}
            </span>
          )}
        </>
      }
    >
      {(close) =>
        count === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-gray-300">
            <Check className="h-4 w-4 text-mint-400" aria-hidden />
            {t("needsYou.allClear")}
          </p>
        ) : (
          <div>
            <p className="mb-3 text-[13px] font-semibold text-gray-100">
              {t("needsYou.title", { count })}
            </p>
            <div className="[&_ul]:grid-cols-1">
              <SlipList onNavigate={close} />
            </div>
          </div>
        )
      }
    </Popover>
  );
}
