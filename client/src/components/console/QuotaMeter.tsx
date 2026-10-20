/**
 * @file QuotaMeter.tsx
 * @description Compact Claude Direct fuel gauge for the top bar: an 8-bit segmented meter with the free
 * percentage and time to empty. It turns amber under 20% and coral under 10%. Clicking it opens a
 * popover with the full quota breakdown ({@link QuotaDetails}) and a link to the Usage page. This
 * replaces the always-on quota strip that used to sit on every page.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  formatHours,
  quotaTone,
  summarizeClaudeWindow,
  useQuotaTelemetry,
} from "../../lib/useQuotaTelemetry";
import { PixelMeter } from "./PixelMeter";
import { Popover } from "./Popover";
import { QuotaDetails } from "./QuotaDetails";
import { poolMeta } from "./pools";

/**
 * Top-bar quota meter.
 *
 * @returns The meter and its popover.
 */
export function QuotaMeter() {
  const { t } = useTranslation("console");
  const { quota, cascade } = useQuotaTelemetry();
  const claude = summarizeClaudeWindow(quota);
  const free = claude?.freeFraction ?? 1;
  const tone = quotaTone(free);
  const fill =
    tone === "critical" ? "bg-coral-400" : tone === "low" ? "bg-amber-400" : poolMeta(3).fill;
  const pct = Math.round(free * 100);

  return (
    <Popover
      label={t("quota.meterLabel")}
      triggerClassName="group inline-flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-surface-3"
      trigger={
        <>
          <span className="hidden text-gray-400 lg:inline">{t("pools.claudeDirect")}</span>
          <PixelMeter
            value={free}
            blocks={12}
            fillClass={fill}
            heightClass="h-2"
            className="w-[72px]"
            label={t("quota.meterLabel")}
          />
          <span className="tabular-nums text-gray-100">{claude ? `${pct}%` : "--"}</span>
          {claude?.hoursToEmpty != null && (
            <span className="hidden tabular-nums text-gray-500 xl:inline">
              {formatHours(claude.hoursToEmpty)}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <div>
          <QuotaDetails quota={quota} cascade={cascade} />
          <Link
            to="/usage"
            onClick={close}
            className="mt-4 flex items-center justify-center rounded-lg border border-border-light px-3 py-2 text-[13px] font-medium text-gray-200 transition-colors hover:bg-surface-3"
          >
            {t("quota.openUsage")}
          </Link>
        </div>
      )}
    </Popover>
  );
}
