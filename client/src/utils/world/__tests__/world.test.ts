/**
 * @file world.test.ts
 * @description Tests for the Agent World engine: projection round trips and
 * horizon clamping, map walkability, the sandbox reducer (create, pause, resume,
 * move, zone change, rename, delete, clear, cap), defensive storage loading,
 * live desk assignment, and entity stepping and sandbox behavior.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { horizonY, project, unproject } from "../projection";
import type { Camera, Viewport } from "../projection";
import { MAP_H, MAP_W, ZONE_AREAS, isWalkable, tileAt, zoneDoor } from "../worldMap";
import {
  SANDBOX_MAX,
  SANDBOX_STORAGE_KEY,
  loadSandbox,
  sandboxReducer,
  saveSandbox,
} from "../sandbox";
import type { SandboxAgent, SandboxDraft } from "../sandbox";
import {
  advanceSandboxEntity,
  liveEntitiesFrom,
  sandboxEntitiesFrom,
  stepEntity,
} from "../entities";
import type { WorldEntity } from "../entities";
import type { Agent } from "../../../lib/types";

const cam: Camera = { x: MAP_W / 2, y: MAP_H / 2, zoom: 1 };
const vp: Viewport = { width: 1000, height: 700 };
const draft: SandboxDraft = { name: "Scout", variant: "gemini-flash", zone: "engine", task: "" };

function create(state: SandboxAgent[], id: string, over: Partial<SandboxDraft> = {}) {
  return sandboxReducer(state, { type: "create", id, now: 1, agent: { ...draft, ...over } });
}

describe("projection", () => {
  it("round-trips ground points through project and unproject", () => {
    for (let i = 0; i < 20; i++) {
      const wx = 2 + ((i * 7) % 26);
      const wy = 1 + ((i * 5) % 18);
      const p = project(wx, wy, cam, vp);
      expect(p).not.toBeNull();
      const back = unproject(p!.sx, p!.sy, cam, vp);
      expect(back).not.toBeNull();
      expect(Math.abs(back!.wx - wx)).toBeLessThan(0.01);
      expect(Math.abs(back!.wy - wy)).toBeLessThan(0.01);
    }
  });

  it("returns null above the horizon and finite values just below it", () => {
    const h = horizonY(cam, vp);
    expect(unproject(500, h - 5, cam, vp)).toBeNull();
    const near = unproject(500, h + 0.6, cam, vp);
    expect(near).not.toBeNull();
    expect(Number.isFinite(near!.wx) && Number.isFinite(near!.wy)).toBe(true);
  });

  it("keeps the look-at point at the viewport center", () => {
    const p = project(cam.x, cam.y, cam, vp)!;
    expect(p.sx).toBeCloseTo(vp.width / 2, 5);
    expect(p.sy).toBeCloseTo(vp.height / 2, 5);
  });

  it("draws far rows higher and smaller than near rows", () => {
    const far = project(15, 1, cam, vp)!;
    const near = project(15, 18, cam, vp)!;
    expect(far.sy).toBeLessThan(near.sy);
    expect(far.scale).toBeLessThan(near.scale);
  });
});

describe("world map", () => {
  it("rings the map with walls and labels zones", () => {
    expect(tileAt(0, 5)).toBe("wall");
    expect(tileAt(MAP_W - 1, 5)).toBe("wall");
    expect(tileAt(3, 3)).toBe("conductor");
    expect(tileAt(20, 15)).toBe("vault");
    expect(tileAt(14, 9)).toBe("path");
    expect(isWalkable(0.5, 0.5)).toBe(false);
  });

  it("keeps every desk and door on walkable ground", () => {
    for (const z of ZONE_AREAS) {
      for (const d of z.desks) expect(isWalkable(d.x, d.y)).toBe(true);
      const door = zoneDoor(z.id);
      expect(tileAt(Math.floor(door.x), Math.floor(door.y))).toBe(z.id);
    }
  });
});

describe("sandbox reducer", () => {
  it("creates, pauses, resumes, and deletes an agent", () => {
    let s = create([], "a");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: "a", name: "Scout", zone: "engine", paused: false });
    expect(isWalkable(s[0]!.x, s[0]!.y)).toBe(true);
    s = sandboxReducer(s, { type: "pause", id: "a" });
    expect(s[0]!.paused).toBe(true);
    s = sandboxReducer(s, { type: "resume", id: "a" });
    expect(s[0]!.paused).toBe(false);
    s = sandboxReducer(s, { type: "delete", id: "a" });
    expect(s).toEqual([]);
  });

  it("caps the sandbox at the maximum size", () => {
    let s: SandboxAgent[] = [];
    for (let i = 0; i < SANDBOX_MAX + 3; i++) s = create(s, `a${i}`);
    expect(s).toHaveLength(SANDBOX_MAX);
  });

  it("moves within the map, updates the zone, and refuses walls", () => {
    let s = create([], "a");
    s = sandboxReducer(s, { type: "move", id: "a", x: 4.5, y: 15.5 });
    expect(s[0]).toMatchObject({ x: 4.5, y: 15.5, zone: "fanout" });
    const before = s;
    s = sandboxReducer(s, { type: "move", id: "a", x: 14.5, y: 0.2 });
    expect(s[0]!.y).toBeGreaterThanOrEqual(1.5);
    expect(sandboxReducer(before, { type: "move", id: "missing", x: 3, y: 3 })).toEqual(before);
  });

  it("moves to a zone, renames, pauses all, and clears", () => {
    let s = create(create([], "a"), "b");
    s = sandboxReducer(s, { type: "moveToZone", id: "a", zone: "vault" });
    expect(s[0]!.zone).toBe("vault");
    expect(tileAt(Math.floor(s[0]!.x), Math.floor(s[0]!.y))).toBe("vault");
    s = sandboxReducer(s, { type: "rename", id: "b", name: "  Builder  " });
    expect(s[1]!.name).toBe("Builder");
    expect(sandboxReducer(s, { type: "rename", id: "b", name: "   " })).toBe(s);
    s = sandboxReducer(s, { type: "pauseAll" });
    expect(s.every((a) => a.paused)).toBe(true);
    expect(sandboxReducer(s, { type: "clear" })).toEqual([]);
  });
});

describe("sandbox storage", () => {
  beforeEach(() => localStorage.clear());

  it("ignores corrupt and foreign data", () => {
    localStorage.setItem(SANDBOX_STORAGE_KEY, "{not json");
    expect(loadSandbox()).toEqual([]);
    localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify([{ id: 1 }]));
    expect(loadSandbox()).toEqual([]);
    localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ id: "x" }));
    expect(loadSandbox()).toEqual([]);
  });

  it("round-trips valid agents", () => {
    const s = create([], "a");
    saveSandbox(s);
    expect(loadSandbox()).toEqual(s);
  });
});

function agent(over: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    session_id: "s1",
    name: "Main",
    type: "main",
    subagent_type: null,
    status: "working",
    task: null,
    current_tool: "Bash",
    started_at: "2026-10-19T00:00:00.000Z",
    ended_at: null,
    updated_at: "2026-10-19T00:00:00.000Z",
    parent_agent_id: null,
    metadata: null,
    ...over,
  } as Agent;
}

describe("live entities", () => {
  it("gives each live agent its own desk, stable across updates", () => {
    const agents = [agent({ id: "a" }), agent({ id: "b", session_id: "s2" })];
    const first = liveEntitiesFrom(agents, new Map(), new Map());
    expect(first).toHaveLength(2);
    expect(first.every((e) => e.source === "live" && e.zone === "conductor")).toBe(true);
    expect(new Set(first.map((e) => `${e.tx},${e.ty}`)).size).toBe(2);
    expect(first[0]).toMatchObject({ x: first[0]!.tx, y: first[0]!.ty, activity: "working" });
    const again = liveEntitiesFrom(agents, new Map(), new Map(first.map((e) => [e.id, e])));
    expect(again.map((e) => [e.tx, e.ty])).toEqual(first.map((e) => [e.tx, e.ty]));
  });

  it("walks late arrivals in from the room door", () => {
    const first = liveEntitiesFrom([agent({ id: "a" })], new Map(), new Map());
    const prev = new Map(first.map((e) => [e.id, e]));
    const next = liveEntitiesFrom([agent({ id: "a" }), agent({ id: "c" })], new Map(), prev);
    const late = next.find((e) => e.id === "c")!;
    expect({ x: late.x, y: late.y }).toEqual(zoneDoor("conductor"));
  });
});

describe("entity stepping and behavior", () => {
  const base = (): WorldEntity =>
    sandboxEntitiesFrom(create([], "a"), new Map(), 0)[0] as WorldEntity;

  it("walks toward the target and snaps with reduced motion", () => {
    const e = base();
    const moved = stepEntity(e, 0.1, false);
    expect(Math.hypot(moved.tx - moved.x, moved.ty - moved.y)).toBeLessThan(
      Math.hypot(e.tx - e.x, e.ty - e.y)
    );
    const snapped = stepEntity(e, 0.1, true);
    expect({ x: snapped.x, y: snapped.y }).toEqual({ x: e.tx, y: e.ty });
  });

  it("does not move or change behavior while paused", () => {
    const paused = { ...base(), activity: "paused" as const };
    expect(stepEntity(paused, 1, false)).toBe(paused);
    expect(advanceSandboxEntity(paused, 100)).toBe(paused);
  });

  it("cycles work, wander, think, and return home", () => {
    let e = stepEntity(base(), 0, true);
    e = advanceSandboxEntity(e, 0);
    expect(e.activity).toBe("working");
    e = advanceSandboxEntity(e, 7, () => 0.5);
    expect(e.activity).toBe("walking");
    e = advanceSandboxEntity(stepEntity(e, 0, true), 7);
    expect(e.activity).toBe("thinking");
    e = advanceSandboxEntity(e, 11);
    expect(e).toMatchObject({ activity: "walking", tx: e.homeX, ty: e.homeY });
  });

  it("teleports a sandbox agent whose home moved", () => {
    const s = create([], "a");
    const first = sandboxEntitiesFrom(s, new Map(), 0);
    const moved = sandboxReducer(s, { type: "move", id: "a", x: 4.5, y: 15.5 });
    const next = sandboxEntitiesFrom(moved, new Map(first.map((e) => [e.id, e])), 1)[0]!;
    expect(next).toMatchObject({ x: 4.5, y: 15.5, zone: "fanout", activity: "working" });
  });
});
