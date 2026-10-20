/**
 * @file pools.ts
 * @description The three agy-cascade quota pools as display metadata for the Nexus Console: waterfall
 * order, plain-language i18n keys, and the only colour forms a pool ink may take (a dot, a meter fill,
 * a thin left tab, and a light wash). Also derives each pool's live state (active, standby, exhausted
 * with its cooldown) from the cascade status.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { resolveActivePoolNumber } from "../../utils/agentTheme";
import type { CascadeStatus } from "../../lib/types";

/** Pool number in waterfall order: 1 AGY-Claude, 2 AGY-Gemini, 3 Claude Direct. */
export type PoolNumber = 1 | 2 | 3;

/** Display metadata for one pool. */
export interface PoolMeta {
  number: PoolNumber;
  /** Key under `console:pools`. */
  key: "agyClaude" | "agyGemini" | "claudeDirect";
  dot: string;
  fill: string;
  tab: string;
  wash: string;
  text: string;
}

/** Pools in waterfall order (work pours from 1 to 3; 3 is the one to protect). */
export const POOLS: readonly PoolMeta[] = [
  {
    number: 1,
    key: "agyClaude",
    dot: "bg-lilac-400",
    fill: "bg-lilac-400",
    tab: "border-l-lilac-400",
    wash: "bg-lilac-400/10",
    text: "text-lilac-300",
  },
  {
    number: 2,
    key: "agyGemini",
    dot: "bg-glacier-400",
    fill: "bg-glacier-400",
    tab: "border-l-glacier-400",
    wash: "bg-glacier-400/10",
    text: "text-glacier-300",
  },
  {
    number: 3,
    key: "claudeDirect",
    dot: "bg-clay-400",
    fill: "bg-clay-400",
    tab: "border-l-clay-400",
    wash: "bg-clay-400/10",
    text: "text-clay-300",
  },
];

/**
 * Look up a pool by number.
 *
 * @param n - Pool number.
 * @returns Its metadata.
 */
export function poolMeta(n: PoolNumber): PoolMeta {
  return POOLS[n - 1]!;
}

/** Live state of one pool. */
export interface PoolState {
  meta: PoolMeta;
  state: "active" | "standby" | "exhausted";
  /** Seconds left in the exhaustion cooldown (0 unless exhausted). */
  cooldownSeconds: number;
}

/**
 * Derive every pool's state from the cascade status.
 *
 * @param cascade - Cascade status, or null before the first fetch.
 * @returns One entry per pool in waterfall order.
 */
export function poolStates(cascade: CascadeStatus | null): PoolState[] {
  const p1Exhausted = Boolean(cascade?.pools?.claude?.exhausted);
  const p2Exhausted = Boolean(cascade?.pools?.gemini?.exhausted);
  const active = resolveActivePoolNumber(
    cascade?.active_pool,
    p1Exhausted ? (p2Exhausted ? 3 : 2) : 1
  );
  return POOLS.map((meta) => {
    const exhausted = meta.number === 1 ? p1Exhausted : meta.number === 2 ? p2Exhausted : false;
    const cooldownSeconds =
      meta.number === 1
        ? (cascade?.pools?.claude?.remaining_seconds ?? 0)
        : meta.number === 2
          ? (cascade?.pools?.gemini?.remaining_seconds ?? 0)
          : 0;
    return {
      meta,
      state: exhausted ? "exhausted" : meta.number === active ? "active" : "standby",
      cooldownSeconds: exhausted ? cooldownSeconds : 0,
    };
  });
}

/**
 * Seconds as "mm:ss".
 *
 * @param total - Seconds.
 * @returns Clock label.
 */
export function formatCooldown(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
