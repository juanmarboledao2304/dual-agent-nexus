/**
 * @file NexusBadges.tsx
 * @description Shared DualAgent Nexus telemetry badges: the quota pool pill
 * (`[POOL 1 • AGY-CLAUDE]`, `[POOL 2 • AGY-GEMINI]`, `[POOL 3 • CLAUDE DIRECT]`) and the 4-bar
 * reasoning effort meter (`LOW`, `MED`, `HIGH`, `MAX`). Used by agent cards, cascade hierarchy
 * nodes, the inspector drawer, and Agent Rooms workstation pods so every surface encodes pool
 * and effort the same way.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { resolveQuotaPoolBadge } from "../utils/agentTheme";
import type { AgentThermalTheme } from "../utils/agentTheme";

/** Props for {@link PoolPill}. */
interface PoolPillProps {
  theme: Pick<AgentThermalTheme, "provider" | "providerPillClass">;
  /** Wrap the label in brackets, e.g. `[POOL 1 • AGY-CLAUDE]`. */
  bracketed?: boolean;
  className?: string;
}

/**
 * Render the quota pool pill for an agent's thermal theme.
 *
 * @param props - See {@link PoolPillProps}.
 * @returns The pill element.
 */
export function PoolPill({ theme, bracketed = true, className = "" }: PoolPillProps) {
  const { label } = resolveQuotaPoolBadge(theme.provider);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider whitespace-nowrap ${theme.providerPillClass} ${className}`}
      data-testid="pool-pill"
    >
      {bracketed ? `[${label}]` : label}
    </span>
  );
}

/** Props for {@link EffortMeter}. */
interface EffortMeterProps {
  theme: Pick<AgentThermalTheme, "effortBars" | "effortLabel" | "barActiveClass">;
  /** Show the `LOW` / `MED` / `HIGH` / `MAX` label beside the bars. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Render the 4-bar reasoning effort meter, bars rising left to right.
 *
 * @param props - See {@link EffortMeterProps}.
 * @returns The meter element.
 */
export function EffortMeter({ theme, showLabel = true, className = "" }: EffortMeterProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 flex-shrink-0 ${className}`}
      title={`Reasoning Effort: ${theme.effortLabel}`}
      aria-label={`Reasoning effort ${theme.effortLabel}`}
    >
      <span className="flex items-end gap-0.5 h-2.5" aria-hidden>
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-1 ${bar <= theme.effortBars ? theme.barActiveClass : "bg-slate-700/50"}`}
            style={{ height: `${bar * 25}%` }}
          />
        ))}
      </span>
      {showLabel && (
        <span className="text-[9px] font-mono font-semibold text-slate-400">
          {theme.effortLabel}
        </span>
      )}
    </span>
  );
}
