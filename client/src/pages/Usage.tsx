/**
 * @file Usage.tsx
 * @description The Usage section: quota first, analytics second. The top card is the full quota
 * breakdown (waterfall, Claude Direct 5-hour window, Antigravity) with the digest return on delegation
 * (tokens kept off Claude Direct, their share of the window, average per digest). Below it sits the full
 * analytics view (activity heatmap, cost, tokens, productivity, workflow intelligence). Replaces the old
 * Quota & Digest ROI page and the always-on quota strip.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useTranslation } from "react-i18next";
import { formatTokens, useQuotaTelemetry } from "../lib/useQuotaTelemetry";
import { QuotaDetails } from "../components/console/QuotaDetails";
import { Analytics } from "./Analytics";

/**
 * Usage page.
 *
 * @returns The page.
 */
export function Usage() {
  const { t } = useTranslation("console");
  const { quota, cascade } = useQuotaTelemetry();
  const offloaded = cascade?.tokens_offloaded ?? 0;
  const digests = cascade?.digest_count ?? 0;
  const cap = quota?.claude.window_5h_cap ?? 0;
  const roi: Array<[string, string, string]> = [
    [
      t("usage.roi.offloaded"),
      formatTokens(offloaded),
      t("usage.roi.offloadedHint", {
        count: digests,
        avg: formatTokens(digests > 0 ? offloaded / digests : 0),
      }),
    ],
    [
      t("usage.roi.windowShare"),
      `${cap > 0 ? ((offloaded / cap) * 100).toFixed(1) : "0.0"}%`,
      t("usage.roi.windowShareHint", { cap: formatTokens(cap) }),
    ],
  ];

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header>
        <h1 className="page-title">{t("usage.title")}</h1>
        <p className="mt-1 text-[14px] text-gray-400">{t("usage.subtitle")}</p>
      </header>

      <section className="card p-5" aria-label={t("usage.quotaTitle")}>
        <QuotaDetails quota={quota} cascade={cascade} wide />
        <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          {roi.map(([label, value, hint]) => (
            <div key={label}>
              <dt className="text-[13px] text-gray-400">{label}</dt>
              <dd className="mt-1 font-pixel text-[28px] leading-none text-gray-50 tabular-nums">
                {value}
              </dd>
              <dd className="mt-1 text-xs text-gray-500">{hint}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Analytics />
    </div>
  );
}
