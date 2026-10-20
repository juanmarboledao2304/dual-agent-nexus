/**
 * @file entities.ts
 * @description Agent World entities: maps live dashboard agents to desk slots in
 * their room (read-only), turns sandbox agents into wandering workers, and steps
 * movement and sandbox behavior over time.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { Agent, Session } from "../../lib/types";
import { buildRoomLayout, ROOM_ZONES } from "../agentRooms";
import type { RoomZoneId } from "../agentRooms";
import { getAgentThermalTheme } from "../agentTheme";
import { resolveAvatarState, resolveSpriteVariant } from "../pixelSprites";
import type { PixelAvatarState, SpriteVariant } from "../pixelSprites";
import type { SandboxAgent } from "./sandbox";
import { deskWorkSpot, isWalkable, zoneArea, zoneDoor } from "./worldMap";

export type WorldSource = "live" | "sandbox";

export type WorldActivity =
  | "idle"
  | "walking"
  | "working"
  | "thinking"
  | "waiting"
  | "paused"
  | "done"
  | "error";

/** One character in the world. `x`/`y` is the current position, `tx`/`ty` the target (tiles). */
export interface WorldEntity {
  id: string;
  source: WorldSource;
  name: string;
  variant: SpriteVariant;
  zone: RoomZoneId;
  x: number;
  y: number;
  tx: number;
  ty: number;
  activity: WorldActivity;
  task: string | null;
  facing: "left" | "right";
  /** Sandbox only: home position the agent returns to. */
  homeX: number;
  homeY: number;
  /** Sandbox only: world time (seconds) when the current behavior phase ends. */
  phaseUntil: number;
}

/** Walking speed in tiles per second. */
export const WALK_SPEED = 2.4;
/** Distance under which an entity snaps onto its target. */
const ARRIVE_EPSILON = 0.02;
/** Live agents shown per zone beyond the desk count (standing room). */
const STANDING_ROOM = 6;

const ACTIVITY_BY_STATE: Record<PixelAvatarState, WorldActivity> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  waiting_approval: "waiting",
  completed: "done",
  error: "error",
};

/** 32-bit FNV-1a hash, used for stable desk assignment. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Place live agents at desks in their room. Desk choice is a stable hash of the agent id with
 * linear probing; agents beyond the desks stand in a row near the room's front edge. Agents seen
 * before keep their current position and walk to the new target; on the first load they start at
 * their desk, and later arrivals walk in from the room's door.
 *
 * @param agents - Live agents (one row per id).
 * @param sessionsById - Sessions, used for the sprite's provider/model fallback.
 * @param prev - Entities from the previous update, keyed by id.
 * @returns Live entities.
 */
export function liveEntitiesFrom(
  agents: Agent[],
  sessionsById: Map<string, Session>,
  prev: Map<string, WorldEntity>
): WorldEntity[] {
  const layout = buildRoomLayout(agents);
  const firstLoad = prev.size === 0;
  const out: WorldEntity[] = [];

  for (const { id: zoneId } of ROOM_ZONES) {
    const zone = zoneArea(zoneId);
    const taken = new Set<number>();
    const members = layout.zones[zoneId].slice(0, zone.desks.length + STANDING_ROOM);
    let standing = 0;

    for (const agent of members) {
      let target: { x: number; y: number };
      if (taken.size < zone.desks.length) {
        let slot = fnv1a(agent.id) % zone.desks.length;
        while (taken.has(slot)) slot = (slot + 1) % zone.desks.length;
        taken.add(slot);
        target = deskWorkSpot(zone.desks[slot] as { x: number; y: number });
      } else {
        const front = zone.y < 9 ? zone.y + zone.h - 1.2 : zone.y + 1.2;
        target = { x: zone.x + 1.5 + (standing % (zone.w - 2)), y: front };
        standing += 1;
      }

      const session = sessionsById.get(agent.session_id) ?? null;
      const theme = getAgentThermalTheme(agent, session?.provider, session?.model);
      const before = prev.get(agent.id);
      const spawn =
        before && before.zone === zoneId ? before : firstLoad ? target : zoneDoor(zoneId);

      out.push({
        id: agent.id,
        source: "live",
        name: agent.name || agent.id.slice(0, 8),
        variant: resolveSpriteVariant(theme.provider, theme.tier),
        zone: zoneId,
        x: spawn.x,
        y: spawn.y,
        tx: target.x,
        ty: target.y,
        activity: ACTIVITY_BY_STATE[resolveAvatarState(agent)],
        task: agent.task ?? null,
        facing: before?.facing ?? "right",
        homeX: target.x,
        homeY: target.y,
        phaseUntil: 0,
      });
    }
  }
  return out;
}

/** Work phase length for sandbox agents, in seconds. */
const WORK_SECONDS = 6;
/** Think phase length for sandbox agents, in seconds. */
const THINK_SECONDS = 3;

/**
 * Turn sandbox agents into entities, carrying over position and behavior from the previous update.
 * A moved home (drag or zone change) teleports the agent there and restarts its work phase.
 *
 * @param agents - Sandbox agents.
 * @param prev - Entities from the previous update, keyed by id.
 * @param nowSec - Current world time in seconds.
 * @returns Sandbox entities.
 */
export function sandboxEntitiesFrom(
  agents: SandboxAgent[],
  prev: Map<string, WorldEntity>,
  nowSec: number
): WorldEntity[] {
  return agents.map((a) => {
    const before = prev.get(a.id);
    const homeMoved = !before || before.homeX !== a.x || before.homeY !== a.y;
    if (!before) {
      const door = zoneDoor(a.zone);
      return {
        id: a.id,
        source: "sandbox",
        name: a.name,
        variant: a.variant,
        zone: a.zone,
        x: door.x,
        y: door.y,
        tx: a.x,
        ty: a.y,
        activity: a.paused ? "paused" : "walking",
        task: a.task || null,
        facing: a.x < door.x ? "left" : "right",
        homeX: a.x,
        homeY: a.y,
        phaseUntil: nowSec,
      };
    }
    const base: WorldEntity = { ...before, name: a.name, variant: a.variant, zone: a.zone };
    base.task = a.task || null;
    if (homeMoved) {
      return {
        ...base,
        x: a.x,
        y: a.y,
        tx: a.x,
        ty: a.y,
        homeX: a.x,
        homeY: a.y,
        activity: a.paused ? "paused" : "working",
        phaseUntil: nowSec + WORK_SECONDS,
      };
    }
    if (a.paused) return { ...base, activity: "paused", tx: base.x, ty: base.y };
    if (before.activity === "paused") {
      return { ...base, activity: "working", phaseUntil: nowSec + WORK_SECONDS };
    }
    return base;
  });
}

/**
 * Advance a sandbox agent's behavior loop: work at home, wander to a random walkable spot in its
 * room, think there, walk home, and repeat. Paused agents do not change.
 *
 * @param e - Sandbox entity.
 * @param nowSec - Current world time in seconds.
 * @param rand - Random source in [0, 1); injectable for tests.
 * @returns The updated entity.
 */
export function advanceSandboxEntity(
  e: WorldEntity,
  nowSec: number,
  rand: () => number = Math.random
): WorldEntity {
  if (e.source !== "sandbox" || e.activity === "paused") return e;
  const arrived = Math.hypot(e.tx - e.x, e.ty - e.y) < ARRIVE_EPSILON;

  if (e.activity === "walking") {
    if (!arrived) return e;
    const atHome = Math.hypot(e.homeX - e.x, e.homeY - e.y) < ARRIVE_EPSILON;
    return atHome
      ? { ...e, activity: "working", phaseUntil: nowSec + WORK_SECONDS }
      : { ...e, activity: "thinking", phaseUntil: nowSec + THINK_SECONDS };
  }
  if (nowSec < e.phaseUntil) return e;

  if (e.activity === "thinking") {
    return { ...e, activity: "walking", tx: e.homeX, ty: e.homeY };
  }
  // Work phase over: pick a wander spot inside the room.
  const zone = zoneArea(e.zone);
  for (let attempt = 0; attempt < 6; attempt++) {
    const x = zone.x + 0.8 + rand() * (zone.w - 1.6);
    const y = zone.y + 0.8 + rand() * (zone.h - 1.6);
    if (isWalkable(x, y)) return { ...e, activity: "walking", tx: x, ty: y };
  }
  return { ...e, phaseUntil: nowSec + WORK_SECONDS };
}

/**
 * Move an entity toward its target. Paused agents stay put; with reduced motion the
 * entity snaps to its target instead of walking.
 *
 * @param e - Entity.
 * @param dtSec - Elapsed time in seconds.
 * @param reducedMotion - Whether the user prefers reduced motion.
 * @returns The moved entity (the same object when it did not move).
 */
export function stepEntity(e: WorldEntity, dtSec: number, reducedMotion: boolean): WorldEntity {
  if (e.activity === "paused") return e;
  const dx = e.tx - e.x;
  const dy = e.ty - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return e;
  const facing = Math.abs(dx) > 0.01 ? (dx < 0 ? "left" : "right") : e.facing;
  if (reducedMotion || dist < ARRIVE_EPSILON) return { ...e, x: e.tx, y: e.ty, facing };
  const travel = Math.min(dist, WALK_SPEED * dtSec);
  return { ...e, x: e.x + (dx / dist) * travel, y: e.y + (dy / dist) * travel, facing };
}

/** Whether an entity is currently walking (between positions). */
export function isMoving(e: WorldEntity): boolean {
  return Math.hypot(e.tx - e.x, e.ty - e.y) >= ARRIVE_EPSILON;
}
