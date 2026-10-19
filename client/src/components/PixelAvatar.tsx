/**
 * @file PixelAvatar.tsx
 * @description Pure-SVG 8-bit sprite avatar for DualAgent Nexus agents and subagents. Resolves
 * the agent's quota pool and model tier to one of eight character sprites (see
 * `utils/pixelSprites.ts`), and renders its lifecycle as stepped CSS animation: a bobbing
 * sprite with a 3-dot indicator while thinking, a pulsing frame plus a tool badge (`BASH`,
 * `READ`, `EDIT`, `GREP`, `FAN-OUT`) while working, a pulsing amber frame for
 * `APPROVAL REQUIRED`, and an emerald frame with a `DIGEST` badge on completion. Used by
 * AgentCard, SubagentGraph nodes, AgentInspectorDrawer, the Agent Rooms pods, and the
 * CommandCenterDock.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { CSSProperties } from "react";
import { getAgentThermalTheme, parseAgentMetadata } from "../utils/agentTheme";
import {
  SPRITE_DEFINITIONS,
  SPRITE_GRID,
  avatarBadgeLabel,
  buildSpriteRects,
  resolveAvatarState,
  resolveSpriteVariant,
} from "../utils/pixelSprites";
import type { PixelAvatarState, SpriteVariant } from "../utils/pixelSprites";
import type { Agent, Session } from "../lib/types";

/** Props for {@link PixelAvatar}. */
export interface PixelAvatarProps {
  /** Agent to depict; drives the variant, state, and badge unless overridden. */
  agent?: Agent | null;
  /** Owning session, used as the provider/model fallback for the agent. */
  session?: Session | null;
  /** Explicit sprite, for agent-less surfaces such as legends and presets. */
  variant?: SpriteVariant;
  /** Explicit state; defaults to the agent's resolved lifecycle state. */
  state?: PixelAvatarState;
  /** Explicit tool name for the working badge; defaults to `agent.current_tool`. */
  tool?: string | null;
  /** Rendered sprite edge length in CSS pixels (multiples of 16 stay sharpest). */
  size?: number;
  /** Show the status badge under the sprite. */
  showBadge?: boolean;
  /** Draw the state frame (pulse / amber / emerald) around the sprite. */
  framed?: boolean;
  /** Reserve the 3-dot thinking row above the sprite. Off for inline icons. */
  indicator?: boolean;
  className?: string;
}

const STATE_LABELS: Record<PixelAvatarState, string> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  waiting_approval: "waiting for approval",
  completed: "completed",
  error: "error",
};

const FRAME_CLASSES: Record<PixelAvatarState, string> = {
  idle: "",
  thinking: "",
  working: "pixel-frame-working",
  waiting_approval: "pixel-frame-approval",
  completed: "pixel-frame-completed",
  error: "pixel-frame-error",
};

const BADGE_CLASSES: Record<PixelAvatarState, string> = {
  idle: "",
  thinking: "",
  working: "bg-slate-900 text-slate-100 border-slate-500/70",
  waiting_approval: "bg-amber-500/20 text-amber-200 border-amber-400/70",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/60",
  error: "bg-red-500/15 text-red-300 border-red-500/60",
};

/**
 * Render an 8-bit character sprite for an agent, framed and badged by its live state.
 *
 * @param props - See {@link PixelAvatarProps}.
 * @returns The sprite with its state indicators.
 */
export function PixelAvatar({
  agent,
  session,
  variant,
  state,
  tool,
  size = 40,
  showBadge = true,
  framed = true,
  indicator = true,
  className = "",
}: PixelAvatarProps) {
  const theme = agent ? getAgentThermalTheme(agent, session?.provider, session?.model) : null;
  const resolvedVariant: SpriteVariant =
    variant ?? (theme ? resolveSpriteVariant(theme.provider, theme.tier) : "claude-sonnet");
  const def = SPRITE_DEFINITIONS[resolvedVariant];
  const resolvedState = state ?? resolveAvatarState(agent);
  const meta = agent ? parseAgentMetadata(agent.metadata) : {};
  const hasDigest = Boolean(meta.digest_received || meta.digest);
  const badge = showBadge
    ? avatarBadgeLabel(resolvedState, tool ?? agent?.current_tool, hasDigest)
    : null;
  const rects = buildSpriteRects(resolvedVariant);
  const dotSize = Math.max(2, Math.round(size / 10));

  const pad = framed ? 4 : 0;
  const frameStyle = {
    width: size + pad,
    height: size + pad,
    "--pixel-accent": def.primaryHex,
    "--pixel-glow": `${def.primaryHex}80`,
  } as CSSProperties;

  return (
    <span
      className={`inline-flex flex-col items-center gap-1 flex-shrink-0 ${className}`}
      data-testid="pixel-avatar"
      data-variant={resolvedVariant}
      data-state={resolvedState}
    >
      {/* 3-dot thinking indicator; the row is reserved so layouts never jump. */}
      {indicator && (
        <span className="flex items-center gap-[2px]" style={{ height: dotSize }} aria-hidden>
          {resolvedState === "thinking" &&
            [0, 1, 2].map((i) => (
              <span
                key={i}
                className="pixel-dot block"
                style={{ width: dotSize, height: dotSize, backgroundColor: def.primaryHex }}
              />
            ))}
        </span>
      )}

      <span
        className={`relative inline-flex items-center justify-center rounded-[3px] ${
          framed ? `bg-slate-950/90 ${FRAME_CLASSES[resolvedState]}` : ""
        }`}
        style={frameStyle}
      >
        <svg
          role="img"
          aria-label={`${def.label} (${def.poolLabel}) — ${STATE_LABELS[resolvedState]}`}
          viewBox={`0 0 ${SPRITE_GRID} ${SPRITE_GRID}`}
          width={size}
          height={size}
          shapeRendering="crispEdges"
          className={`pixel-sprite ${resolvedState === "thinking" ? "pixel-bob" : ""}`}
        >
          {rects.map((r) => (
            <rect
              key={`${r.x}-${r.y}`}
              x={r.x}
              y={r.y}
              width={r.width}
              height={1}
              fill={def.palette[r.role] ?? def.primaryHex}
            />
          ))}
        </svg>
      </span>

      {badge && (
        <span
          className={`px-1 py-px rounded-[2px] border text-[8px] leading-none font-mono font-bold tracking-wider whitespace-nowrap ${BADGE_CLASSES[resolvedState]}`}
        >
          {badge}
        </span>
      )}
    </span>
  );
}
