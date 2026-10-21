/**
 * @file QuotaDetails.tsx
 * @description Full quota breakdown grouped in three plain-language blocks: the agy-cascade waterfall
 * (each pool's state and cooldown, tokens kept off Claude Direct), the Claude Direct 5-hour window
 * (used/cap, burn, time to empty, cache efficiency, token mix, subagents by effort), and Antigravity
 * (flow credits, bandwidth, session tokens, request and token burn, Flash/Pro mix). Every figure the old
 * always-on quota strip showed lives here; the top-bar popover and the Usage page both render it.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useTranslation } from "react-i18next";
import type { CascadeStatus, DualQuotaTelemetry } from "../../lib/types";
import {
  formatHours,
  formatTokens,
  quotaTone,
  summarizeClaudeWindow,
} from "../../lib/useQuotaTelemetry";
import { PixelMeter } from "./PixelMeter";
import { formatCooldown, poolMeta, poolStates } from "./pools";

/** Props for {@link QuotaDetails}. */
export interface QuotaDetailsProps {
  quota: DualQuotaTelemetry | null;
  cascade: CascadeStatus | null;
  /** Two-column layout for wide containers (Usage page); single column in the popover. */
  wide?: boolean;
}

/** One label/value line. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium tabular-nums text-gray-100">{value}</span>
    </div>
  );
}

/**
 * Quota breakdown.
 *
 * @returns The details, or a loading line before the first fetch.
 */
export function QuotaDetails({ quota, cascade, wide = false }: QuotaDetailsProps) {
  const { t } = useTranslation("console");
  const claude = summarizeClaudeWindow(quota);
  if (!quota || !claude) {
    return <p className="text-sm text-gray-500">{t("quota.loading")}</p>;
  }
  const agy = quota.antigravity;
  const tone = quotaTone(claude.freeFraction);
  const claudeFill =
    tone === "critical" ? "bg-coral-400" : tone === "low" ? "bg-amber-400" : poolMeta(3).fill;
  const agyFree = agy.session_cap > 0 ? Math.max(0, 1 - agy.session_tokens / agy.session_cap) : 1;
  const creditsFree =
    agy.flow_credits_limit > 0
      ? Math.max(0, 1 - agy.flow_credits_used / agy.flow_credits_limit)
      : 1;
  const states = poolStates(cascade);
  const effort = (e: { heavy: number; standard: number; light: number }) =>
    t("quota.effortValue", { heavy: e.heavy, standard: e.standard, light: e.light });

  return (
    <div className={wide ? "grid gap-6 lg:grid-cols-3" : "space-y-5"}>
      <section aria-labelledby="quota-waterfall">
        <h3 id="quota-waterfall" className="text-[13px] font-semibold text-gray-100">
          {t("quota.waterfall")}
        </h3>
        <p className="mb-2 text-xs text-gray-500">{t("quota.waterfallHint")}</p>
        <ol className="space-y-1.5">
          {states.map(({ meta, state, cooldownSeconds }) => (
            <li key={meta.number} className="flex items-center gap-2.5 text-[13px]">
              <span className={`status-dot ${state === "exhausted" ? "bg-coral-400" : meta.dot}`} />
              <span
                className="min-w-0 flex-1 truncate text-gray-200"
                title={t("quota.poolNumber", { n: meta.number })}
              >
                {t(`pools.${meta.key}`)}
                <span className="ml-1.5 text-xs text-gray-500">
                  {t(`pools.models.${meta.key}`)}
                </span>
              </span>
              <span
                className={`shrink-0 text-xs ${
                  state === "active"
                    ? "text-gray-50"
                    : state === "exhausted"
                      ? "text-coral-300"
                      : "text-gray-500"
                }`}
              >
                {state === "exhausted"
                  ? t("poolState.exhausted", { time: formatCooldown(cooldownSeconds) })
                  : t(`poolState.${state}`)}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
          <span className="text-gray-400">{t("quota.digest")} </span>
          <span className="font-medium tabular-nums text-gray-50">
            {t("quota.digestValue", {
              tokens: formatTokens(cascade?.tokens_offloaded ?? 0),
              count: cascade?.digest_count ?? 0,
            })}
          </span>
        </div>
      </section>

      <section aria-labelledby="quota-claude">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 id="quota-claude" className="text-[13px] font-semibold text-gray-100">
            {t("pools.claudeDirect")}
          </h3>
          <span className="text-xs tabular-nums text-gray-400">
            {t("quota.free", { pct: Math.round(claude.freeFraction * 100) })}
          </span>
        </div>
        <PixelMeter
          value={claude.freeFraction}
          fillClass={claudeFill}
          heightClass="h-2"
          label={t("quota.meterLabel")}
        />
        <div className="mt-2 divide-y divide-border/60">
          {claude.source === "statusline" ? (
            <>
              <Row
                label={t("quota.window")}
                value={t("quota.usedPct", { pct: Math.round((1 - claude.freeFraction) * 100) })}
              />
              <Row label={t("quota.resetsIn")} value={formatHours(claude.resetsInHours ?? 0)} />
              {claude.weeklyUsedPct != null && (
                <Row
                  label={t("quota.weekly")}
                  value={t("quota.weeklyValue", {
                    pct: Math.round(claude.weeklyUsedPct),
                    time: formatHours(claude.weeklyResetsInHours ?? 0),
                  })}
                />
              )}
            </>
          ) : (
            <>
              <Row
                label={t("quota.window")}
                value={t("quota.usedOf", {
                  used: formatTokens(claude.used),
                  cap: formatTokens(claude.cap),
                })}
              />
              <Row
                label={t("quota.timeToEmpty")}
                value={
                  claude.hoursToEmpty != null ? formatHours(claude.hoursToEmpty) : t("quota.idle")
                }
              />
            </>
          )}
          <Row
            label={t("quota.burn")}
            value={t("quota.perHour", { n: formatTokens(claude.burnPerHour) })}
          />
          <Row label={t("quota.cache")} value={`${claude.cacheEfficiencyPct.toFixed(1)}%`} />
          <Row
            label={t("quota.tokensIO")}
            value={`${formatTokens(quota.claude.input_tokens)} / ${formatTokens(quota.claude.output_tokens)} / ${formatTokens(quota.claude.cache_read_tokens)}`}
          />
          <Row label={t("quota.effort")} value={effort(quota.claude.active_subagents)} />
        </div>
        {claude.source === "estimate" && (
          <p className="mt-2 text-[12px] leading-snug text-gray-500">{t("quota.estimateHint")}</p>
        )}
      </section>

      <section aria-labelledby="quota-agy">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 id="quota-agy" className="text-[13px] font-semibold text-gray-100">
            {t("quota.agyTitle")}
          </h3>
          <span className="text-xs tabular-nums text-gray-400">
            {t("quota.free", { pct: Math.round(agyFree * 100) })}
          </span>
        </div>
        <PixelMeter
          value={agyFree}
          fillClass="bg-lilac-400"
          heightClass="h-2"
          label={t("quota.agyMeterLabel")}
        />
        <div className="mt-2 divide-y divide-border/60">
          <Row
            label={t("quota.sessionTokens")}
            value={t("quota.usedOf", {
              used: formatTokens(agy.session_tokens),
              cap: formatTokens(agy.session_cap),
            })}
          />
          <Row
            label={t("quota.flowCredits")}
            value={`${agy.flow_credits_used} / ${agy.flow_credits_limit} (${Math.round(creditsFree * 100)}%)`}
          />
          <Row label={t("quota.bandwidth")} value={`${agy.context_bandwidth_pct.toFixed(1)}%`} />
          <Row
            label={t("quota.burn")}
            value={`${t("quota.perHour", { n: formatTokens(agy.burn_rate_tokens_per_hr) })}, ${t("quota.requestsPerHour", { n: agy.burn_rate_requests_per_hr })}`}
          />
          <Row
            label={t("quota.modelMix")}
            value={`${Math.round(agy.model_distribution.flash_pct)} : ${Math.round(agy.model_distribution.pro_argon_pct)}`}
          />
          <Row label={t("quota.effort")} value={effort(agy.active_subagents)} />
        </div>
      </section>
    </div>
  );
}
