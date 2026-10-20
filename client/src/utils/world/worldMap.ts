/**
 * @file worldMap.ts
 * @description Static layout of the Agent World: a 30x20 tile floor with four
 * open-plan rooms that mirror the Agent Rooms zones (Conductor Bridge, Cascade
 * Engine, Fan-Out Pods, Digest Vault), the corridors between them, desk slots,
 * and decorative props.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { RoomZoneId } from "../agentRooms";

/** Map width in tiles. */
export const MAP_W = 30;
/** Map height in tiles. */
export const MAP_H = 20;

/** Kind of a ground tile. Zone kinds use the zone's floor color. */
export type TileKind = "floor" | "wall" | "path" | RoomZoneId;

/** A desk position, in tiles. Agents work just north of it, facing the camera. */
export interface DeskSlot {
  x: number;
  y: number;
}

/** One room. `x`/`y`/`w`/`h` are inclusive-start tile bounds. */
export interface ZoneArea {
  id: RoomZoneId;
  x: number;
  y: number;
  w: number;
  h: number;
  desks: readonly DeskSlot[];
}

/** Build a grid of desk slots. */
function deskGrid(xs: number[], ys: number[]): DeskSlot[] {
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

export const ZONE_AREAS: readonly ZoneArea[] = [
  { id: "conductor", x: 1, y: 1, w: 12, h: 7, desks: deskGrid([2.5, 5.5, 8.5, 11.5], [3, 6]) },
  { id: "engine", x: 16, y: 1, w: 13, h: 7, desks: deskGrid([17.5, 20.5, 23.5, 26.5], [3, 6]) },
  {
    id: "fanout",
    x: 1,
    y: 11,
    w: 12,
    h: 8,
    desks: deskGrid([2.5, 4.75, 7, 9.25, 11.5], [13.5, 16.5]),
  },
  {
    id: "vault",
    x: 16,
    y: 11,
    w: 13,
    h: 8,
    desks: deskGrid([18, 21, 24, 27], [13.7, 15.7, 17.7]),
  },
];

/** Corridor row and column. */
const PATH_ROW = 9;
const PATH_COL = 14;

/**
 * Look up a zone by id.
 *
 * @param id - Zone id.
 * @returns The zone area.
 */
export function zoneArea(id: RoomZoneId): ZoneArea {
  return ZONE_AREAS.find((z) => z.id === id) ?? (ZONE_AREAS[0] as ZoneArea);
}

/**
 * Tile kind at integer coordinates. Out-of-bounds tiles count as walls.
 *
 * @param x - Tile column.
 * @param y - Tile row.
 * @returns The tile kind.
 */
export function tileAt(x: number, y: number): TileKind {
  if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) return "wall";
  for (const z of ZONE_AREAS) {
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z.id;
  }
  if (y === PATH_ROW || x === PATH_COL) return "path";
  return "floor";
}

/**
 * Whether an entity may stand at a (fractional) position.
 *
 * @param x - World x in tiles.
 * @param y - World y in tiles.
 * @returns False on walls and outside the map.
 */
export function isWalkable(x: number, y: number): boolean {
  return tileAt(Math.floor(x), Math.floor(y)) !== "wall";
}

/**
 * The zone's entrance: the middle of its edge that faces the central corridor.
 *
 * @param id - Zone id.
 * @returns Door position in tiles (tile center).
 */
export function zoneDoor(id: RoomZoneId): { x: number; y: number } {
  const z = zoneArea(id);
  const x = z.x + Math.floor(z.w / 2) + 0.5;
  const y = z.y < PATH_ROW ? z.y + z.h - 0.5 : z.y + 0.5;
  return { x, y };
}

/** Where an agent stands to work at a desk: just north of it, so the desk occludes its legs. */
export function deskWorkSpot(desk: DeskSlot): { x: number; y: number } {
  return { x: desk.x, y: desk.y - 0.35 };
}

/** A decorative or functional prop, drawn as an upright pixel billboard. */
export interface Prop {
  kind: "desk" | "server" | "plant" | "terminal" | "crate";
  x: number;
  y: number;
}

function buildProps(): Prop[] {
  const props: Prop[] = [];
  for (const z of ZONE_AREAS) {
    for (const d of z.desks) {
      props.push({ kind: z.id === "vault" ? "crate" : "desk", x: d.x, y: d.y });
    }
    props.push({ kind: "plant", x: z.x + 0.5, y: z.y + 0.6 });
    props.push({ kind: "plant", x: z.x + z.w - 0.5, y: z.y + 0.6 });
  }
  props.push({ kind: "server", x: 28.3, y: 2.2 }, { kind: "server", x: 28.3, y: 5.2 });
  props.push({ kind: "terminal", x: PATH_COL + 0.5, y: PATH_ROW + 0.5 });
  return props;
}

export const PROPS: readonly Prop[] = buildProps();
