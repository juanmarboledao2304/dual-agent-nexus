/**
 * @file sandbox.ts
 * @description Sandbox agents for the Agent World: a pure reducer for create,
 * pause, resume, move, delete, and clear, plus defensive localStorage load/save.
 * Sandbox agents are a per-browser playground and never touch real sessions.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { RoomZoneId } from "../agentRooms";
import { SPRITE_DEFINITIONS } from "../pixelSprites";
import type { SpriteVariant } from "../pixelSprites";
import { MAP_H, MAP_W, ZONE_AREAS, isWalkable, tileAt, zoneDoor } from "./worldMap";

/** localStorage key for the persisted sandbox. */
export const SANDBOX_STORAGE_KEY = "nexus-world-sandbox-v1";
/** Maximum number of sandbox agents. */
export const SANDBOX_MAX = 24;

/** A sandbox agent. `x`/`y` is its home position in tiles. */
export interface SandboxAgent {
  id: string;
  name: string;
  variant: SpriteVariant;
  zone: RoomZoneId;
  task: string;
  paused: boolean;
  x: number;
  y: number;
  createdAt: number;
}

/** Fields the creator chooses. */
export type SandboxDraft = Pick<SandboxAgent, "name" | "variant" | "zone" | "task">;

export type SandboxAction =
  | { type: "create"; agent: SandboxDraft; id: string; now: number }
  | { type: "pause" | "resume" | "delete"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "moveToZone"; id: string; zone: RoomZoneId }
  | { type: "rename"; id: string; name: string }
  | { type: "pauseAll" | "resumeAll" | "clear" };

const ZONE_IDS = new Set<string>(ZONE_AREAS.map((z) => z.id));

/**
 * Home position for the n-th sandbox agent in a zone: a row just inside the zone's door,
 * spreading sideways so agents do not stack.
 *
 * @param zone - Zone id.
 * @param index - How many sandbox agents already live in the zone.
 * @returns Home position in tiles.
 */
export function zoneHome(zone: RoomZoneId, index: number): { x: number; y: number } {
  const door = zoneDoor(zone);
  const inward = door.y < MAP_H / 2 ? -1.4 : 1.4;
  const offset = ((index % 5) - 2) * 1.2;
  const row = Math.floor(index / 5) * 1.2 * Math.sign(inward);
  return { x: door.x + offset, y: door.y + inward + row };
}

/**
 * Clamp a position inside the walkable interior of the map.
 *
 * @returns The clamped position, or null when it lands on a wall.
 */
function clampPosition(x: number, y: number): { x: number; y: number } | null {
  const cx = Math.min(MAP_W - 1.5, Math.max(1.5, x));
  const cy = Math.min(MAP_H - 1.5, Math.max(1.5, y));
  return isWalkable(cx, cy) ? { x: cx, y: cy } : null;
}

/** Zone that owns a tile, or null for corridors. */
function zoneAt(x: number, y: number): RoomZoneId | null {
  const kind = tileAt(Math.floor(x), Math.floor(y));
  return ZONE_IDS.has(kind) ? (kind as RoomZoneId) : null;
}

/**
 * Apply one sandbox action.
 *
 * @param state - Current sandbox agents.
 * @param action - Action to apply.
 * @returns The next state (the same array when nothing changed).
 */
export function sandboxReducer(state: SandboxAgent[], action: SandboxAction): SandboxAgent[] {
  switch (action.type) {
    case "create": {
      if (state.length >= SANDBOX_MAX) return state;
      const index = state.filter((a) => a.zone === action.agent.zone).length;
      const home = zoneHome(action.agent.zone, index);
      const pos = clampPosition(home.x, home.y) ?? zoneDoor(action.agent.zone);
      return [
        ...state,
        {
          ...action.agent,
          name: action.agent.name.trim() || "Agent",
          id: action.id,
          createdAt: action.now,
          paused: false,
          x: pos.x,
          y: pos.y,
        },
      ];
    }
    case "pause":
    case "resume": {
      const paused = action.type === "pause";
      return state.map((a) => (a.id === action.id && a.paused !== paused ? { ...a, paused } : a));
    }
    case "pauseAll":
    case "resumeAll": {
      const paused = action.type === "pauseAll";
      return state.some((a) => a.paused !== paused) ? state.map((a) => ({ ...a, paused })) : state;
    }
    case "delete":
      return state.some((a) => a.id === action.id)
        ? state.filter((a) => a.id !== action.id)
        : state;
    case "move": {
      const pos = clampPosition(action.x, action.y);
      if (!pos) return state;
      return state.map((a) =>
        a.id === action.id ? { ...a, x: pos.x, y: pos.y, zone: zoneAt(pos.x, pos.y) ?? a.zone } : a
      );
    }
    case "moveToZone": {
      const index = state.filter((a) => a.zone === action.zone && a.id !== action.id).length;
      const home = zoneHome(action.zone, index);
      const pos = clampPosition(home.x, home.y) ?? zoneDoor(action.zone);
      return state.map((a) =>
        a.id === action.id ? { ...a, zone: action.zone, x: pos.x, y: pos.y } : a
      );
    }
    case "rename": {
      const name = action.name.trim();
      if (!name) return state;
      return state.map((a) => (a.id === action.id ? { ...a, name: name.slice(0, 40) } : a));
    }
    case "clear":
      return state.length ? [] : state;
    default:
      return state;
  }
}

/** Whether a parsed value is a well-formed sandbox agent. */
function isSandboxAgent(v: unknown): v is SandboxAgent {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.name === "string" &&
    typeof a.variant === "string" &&
    a.variant in SPRITE_DEFINITIONS &&
    typeof a.zone === "string" &&
    ZONE_IDS.has(a.zone) &&
    typeof a.task === "string" &&
    typeof a.paused === "boolean" &&
    typeof a.x === "number" &&
    Number.isFinite(a.x) &&
    typeof a.y === "number" &&
    Number.isFinite(a.y) &&
    typeof a.createdAt === "number"
  );
}

/**
 * Read the persisted sandbox, dropping malformed rows. Never throws.
 *
 * @returns Valid sandbox agents (at most {@link SANDBOX_MAX}).
 */
export function loadSandbox(): SandboxAgent[] {
  try {
    const raw = localStorage.getItem(SANDBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSandboxAgent).slice(0, SANDBOX_MAX);
  } catch {
    return [];
  }
}

/**
 * Persist the sandbox. Storage failures are ignored.
 *
 * @param agents - Sandbox agents to save.
 */
export function saveSandbox(agents: SandboxAgent[]): void {
  try {
    localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(agents));
  } catch {
    /* ignore quota / disabled storage */
  }
}
