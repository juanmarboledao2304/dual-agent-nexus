/**
 * @file QuotaRoi.tsx
 * @description Quota & Digest ROI page (`/quota-roi`, formerly `/analytics`). Opens with a
 * 3-pool return-on-delegation panel — Pool 1 AGY-Claude and Pool 2 AGY-Gemini exhaustion state
 * and cooldowns, Pool 3 Claude Direct 5-hour window usage, tokens kept out of the Claude window
 * via `===DIGEST===` handoffs, and the share of the window those savings represent — then the
 * full cost, token, and productivity analytics below.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Timer, TrendingDown } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { PixelAvatar } from "../components/PixelAvatar";
import { Analytics } from "./Analytics";
import type { SpriteVariant } from "../utils/pixelSprites";
import type { CascadePoolStatus, DualQuotaTelemetry, WSMessage } from "../lib/types";

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtCooldown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Props for {@link PoolCard}. */
interface PoolCardProps {
  pool: 1 | 2 | 3;
  title: string;
  sprite: SpriteVariant;
  active: boolean;
  status?: CascadePoolStatus;
  detail: string;
}

function PoolCard({ pool, title, sprite, active, status, detail }: PoolCardProps) {
  const exhausted = Boolean(status?.exhausted);
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border bg-slate-950/90 ${
        exhausted ? "border-red-500/50" : active ? "border-emerald-500/50" : "border-slate-800"
      }`}
    >
      <PixelAvatar
        variant={sprite}
        state={exhausted ? "error" : active ? "working" : "idle"}
        size={32}
        indicator={false}
        showBadge={false}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
          Pool {pool}
        </p>
        <p className="text-xs font-semibold text-slate-100 truncate">{title}</p>
        <p className="text-[10px] font-mono text-slate-500 truncate">{detail}</p>
      </div>
      <span
        className={`px-1.5 py-0.5 rounded border text-[9px] font-mono font-bold ${
          exhausted
            ? "text-red-300 border-red-500/50"
            : active
              ? "text-emerald-300 border-emerald-500/50"
              : "text-slate-500 border-slate-800"
        }`}
      >
        {exhausted
          ? `EXHAUSTED ${fmtCooldown(status?.remaining_seconds ?? 0)}`
          : active
            ? "ACTIVE"
            : "STANDBY"}
      </span>
    </div>
  );
}

/**
 * Quota & Digest ROI route.
 *
 * @returns The page.
 */
export function QuotaRoi() {
  const [quota, setQuota] = useState<DualQuotaTelemetry | null>(null);

  const load = useCallback(async () => {
    try {
      setQuota(await api.quota.get());
    } catch {
      // Keep the previous figures while the server is unreachable.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(
    () =>
      eventBus.subscribe((msg: WSMessage) => {
        if (msg.type === "quota_updated" && msg.data) setQuota(msg.data as DualQuotaTelemetry);
      }),
    []
  );

  const cascade = quota?.cascade;
  const offloaded = cascade?.tokens_offloaded ?? 0;
  const digests = cascade?.digest_count ?? 0;
  const windowCap = quota?.claude.window_5h_cap ?? 0;
  const windowUsed = quota?.claude.window_5h_tokens ?? 0;
  const windowSharePct = windowCap > 0 ? (offloaded / windowCap) * 100 : 0;
  const perDigest = digests > 0 ? offloaded / digests : 0;
  const activePool = cascade?.active_pool ?? 1;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-lg font-semibold text-slate-100 tracking-tight">
          Quota &amp; Digest ROI
        </h1>
        <p className="text-xs text-slate-400">
          How much Claude Direct quota the agy-cascade waterfall keeps free, followed by full cost
          and token analytics.
        </p>
      </div>

      <section
        aria-label="Quota and digest return on delegation"
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="w-3 h-3" />
              Tokens offloaded via ===DIGEST===
            </p>
            <p className="text-xl font-mono font-bold text-slate-100 mt-1">
              {fmtCompact(offloaded)}
            </p>
            <p className="text-[10px] font-mono text-slate-500">
              {digests} digest{digests === 1 ? "" : "s"} · {fmtCompact(perDigest)} avg each
            </p>
          </div>
          <div className="p-3 rounded-xl border border-orange-500/30 bg-orange-950/15">
            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-orange-300">
              <TrendingDown className="w-3 h-3" />
              Claude 5h window kept free
            </p>
            <p className="text-xl font-mono font-bold text-slate-100 mt-1">
              {windowSharePct.toFixed(1)}%
            </p>
            <p className="text-[10px] font-mono text-slate-500">
              of {fmtCompact(windowCap)} cap · {fmtCompact(windowUsed)} used this window
            </p>
          </div>
          <div className="p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-950/15">
            <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-fuchsia-300">
              <Timer className="w-3 h-3" />
              Active waterfall pool
            </p>
            <p className="text-xl font-mono font-bold text-slate-100 mt-1">Pool {activePool}</p>
            <p className="text-[10px] font-mono text-slate-500 truncate">
              {cascade?.active_pool_label ?? "Pool 1: AGY-Claude"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <PoolCard
            pool={1}
            title="AGY-Claude (Google-paid)"
            sprite="agy-opus"
            active={activePool === 1}
            status={cascade?.pools.claude}
            detail="Opus 5.5 / Sonnet 5.5 / GPT-OSS via agy-cascade"
          />
          <PoolCard
            pool={2}
            title="AGY-Gemini (Google-paid)"
            sprite="gemini-argon"
            active={activePool === 2}
            status={cascade?.pools.gemini}
            detail="Argon 4 / Gemini Pro / 3.8 Flash via agy-cascade"
          />
          <PoolCard
            pool={3}
            title="Claude Direct (Anthropic)"
            sprite="claude-opus"
            active={activePool === 3}
            status={cascade?.pools.claude_direct}
            detail="Main conductor and Haiku Explore subagents"
          />
        </div>
      </section>

      <Analytics />
    </div>
  );
}
