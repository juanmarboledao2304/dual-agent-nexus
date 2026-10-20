/**
 * @file drawWorld.ts
 * @description Canvas 2D renderer for the Agent World: perspective ground tiles
 * with raised walls and zone floors, then props and agents sorted by depth as
 * upright 8-bit billboards with activity badges, selection rings, and name
 * tags, and finally zone name chips on top. Returns hit boxes so the canvas can resolve clicks and drags.
 * All art is original procedural pixel art.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { RoomZoneId } from "../../utils/agentRooms";
import { SPRITE_DEFINITIONS, SPRITE_GRID, buildSpriteRects } from "../../utils/pixelSprites";
import { TILE, project } from "../../utils/world/projection";
import type { Camera, Viewport } from "../../utils/world/projection";
import { MAP_H, MAP_W, PROPS, ZONE_AREAS, tileAt } from "../../utils/world/worldMap";
import type { Prop, TileKind } from "../../utils/world/worldMap";
import { isMoving } from "../../utils/world/entities";
import type { WorldEntity } from "../../utils/world/entities";

/** Screen-space box of a drawn entity, for hit testing (nearest entity last). */
export interface HitBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-frame draw options. */
export interface DrawOptions {
  selectedId: string | null;
  hoveredId: string | null;
  timeSec: number;
  reducedMotion: boolean;
  zoneLabels: Record<RoomZoneId, string>;
}

/** World pixels per sprite pixel: a 16px sprite stands ~0.9 tile tall. */
const SPRITE_PX = 2.7;
/** Wall height in tiles. */
const WALL_H = 0.7;

const FLOOR: Record<TileKind, [string, string]> = {
  floor: ["#1a1d23", "#1e2229"],
  path: ["#22262d", "#252a31"],
  wall: ["#2c313a", "#2c313a"],
  conductor: ["#2a1d14", "#2e2017"],
  engine: ["#14202b", "#17242f"],
  fanout: ["#1e1a2b", "#221d30"],
  vault: ["#14251e", "#172a22"],
};
const WALL_TOP = "#3a404a";
const WALL_FACE = "#262a32";
const GRID_LINE = "rgba(255, 255, 255, 0.04)";

/** Glow color per zone, used for laptop lids and labels. */
const ZONE_GLOW: Record<RoomZoneId, string> = {
  conductor: "#ff8a3d",
  engine: "#5ab8ff",
  fanout: "#a78bfa",
  vault: "#3ddc97",
};

const POOL_MARKER: Record<string, string> = {
  "claude-direct": "#ff8a3d",
  "agy-claude": "#a78bfa",
  "agy-gemini": "#5ab8ff",
};

/** A prop pixel map: rows of palette keys, `.` is transparent. */
interface PixelMap {
  rows: readonly string[];
  palette: Record<string, string>;
}

const PROP_MAPS: Record<Exclude<Prop["kind"], "desk">, PixelMap> = {
  server: {
    rows: [
      ".FFFFFFFFFF.",
      ".FKKKKKKKKF.",
      ".FKgKbKKKKF.",
      ".FKKKKKKKKF.",
      ".FFFFFFFFFF.",
      ".FKKKKKKKKF.",
      ".FKbKgKKKKF.",
      ".FKKKKKKKKF.",
      ".FFFFFFFFFF.",
      ".FKKKKKKKKF.",
      ".FKgKKbKKKF.",
      ".FKKKKKKKKF.",
      ".FFFFFFFFFF.",
      ".FKKKKKKKKF.",
      ".FKbKgKKKKF.",
      ".FKKKKKKKKF.",
      ".FFFFFFFFFF.",
      "..D......D..",
    ],
    palette: { F: "#3a404a", K: "#15171b", g: "#3ddc97", b: "#5ab8ff", D: "#23272d" },
  },
  plant: {
    rows: [
      "...l..l...",
      "..lLl.Ll..",
      ".lLLlLLLl.",
      "..lLLLLl..",
      ".lLlLLlLl.",
      "..lLLLLl..",
      "...lLLl...",
      "....tt....",
      "..PPPPPP..",
      "..PpppPP..",
      "...PPPP...",
      "...PPPP...",
    ],
    palette: { l: "#2ba572", L: "#3ddc97", t: "#2b5a47", P: "#6b4f3a", p: "#8a6a4f" },
  },
  terminal: {
    rows: [
      ".FFFFFFFFFF.",
      ".FSSSSSSSSF.",
      ".FSsSSsSSSF.",
      ".FSSSSSSSSF.",
      ".FSSsSSSsSF.",
      ".FFFFFFFFFF.",
      "....FFFF....",
      "....FFFF....",
      "....FFFF....",
      "..FFFFFFFF..",
    ],
    palette: { F: "#3a404a", S: "#ff8a3d", s: "#ffa466" },
  },
  crate: {
    rows: [
      ".CCCCCCCCCCCC.",
      "CccccccccccccC",
      "CcBBBBBBBBBBcC",
      "CcBbbbbbbbbBcC",
      "CcBBBBBBBBBBcC",
      "CccccccccccccC",
      "CDDDDDDDDDDDDC",
      ".CCCCCCCCCCCC.",
    ],
    palette: { C: "#2b5a47", c: "#3a7a60", B: "#3ddc97", b: "#7ff0c0", D: "#1d3f32" },
  },
};

/** Desk with a laptop whose lid glows in the zone color. */
function deskMap(zone: RoomZoneId): PixelMap {
  return {
    rows: [
      "...LLLLL........",
      "...LllllL.......",
      "TTTTTTTTTTTTTTTT",
      "HHHHHHHHHHHHHHHH",
      "D..............D",
      "D..............D",
    ],
    palette: { L: ZONE_GLOW[zone], l: "#f5f6f8", T: "#4d535d", H: "#373c44", D: "#23272d" },
  };
}

/** 5x5 glyphs for activity badges. */
const GLYPHS: Record<string, readonly string[]> = {
  question: [".XXX.", "X...X", "..XX.", ".....", "..X.."],
  pause: ["XX.XX", "XX.XX", "XX.XX", "XX.XX", "XX.XX"],
  check: ["....X", "...XX", "X.XX.", "XXX..", ".X..."],
  bang: ["..X..", "..X..", "..X..", ".....", "..X.."],
};

/** Fill a projected ground quad for tile (x, y), optionally lifted by `lift` tiles. */
function quad(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  lift = 0
): boolean {
  const a = project(x0, y0, cam, vp);
  const b = project(x1, y0, cam, vp);
  const c = project(x1, y1, cam, vp);
  const d = project(x0, y1, cam, vp);
  if (!a || !b || !c || !d) return false;
  const up = (p: { sy: number; scale: number }) => p.sy - lift * TILE * p.scale;
  ctx.beginPath();
  ctx.moveTo(a.sx, up(a));
  ctx.lineTo(b.sx, up(b));
  ctx.lineTo(c.sx, up(c));
  ctx.lineTo(d.sx, up(d));
  ctx.closePath();
  return true;
}

/** Draw the south face of a raised wall tile (between its lifted and ground near edges). */
function wallFace(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  x: number,
  y: number
): void {
  const g0 = project(x, y + 1, cam, vp);
  const g1 = project(x + 1, y + 1, cam, vp);
  if (!g0 || !g1) return;
  ctx.beginPath();
  ctx.moveTo(g0.sx, g0.sy);
  ctx.lineTo(g1.sx, g1.sy);
  ctx.lineTo(g1.sx, g1.sy - WALL_H * TILE * g1.scale);
  ctx.lineTo(g0.sx, g0.sy - WALL_H * TILE * g0.scale);
  ctx.closePath();
  ctx.fillStyle = WALL_FACE;
  ctx.fill();
}

/** Draw a pixel map as a billboard anchored at its bottom-center. */
function drawPixelMap(
  ctx: CanvasRenderingContext2D,
  map: PixelMap,
  cx: number,
  bottom: number,
  px: number
): { x: number; y: number; w: number; h: number } {
  const width = Math.max(...map.rows.map((r) => r.length));
  const left = cx - (width * px) / 2;
  const top = bottom - map.rows.length * px;
  map.rows.forEach((row, ry) => {
    let rx = 0;
    while (rx < row.length) {
      const key = row[rx] as string;
      if (key === ".") {
        rx += 1;
        continue;
      }
      let end = rx + 1;
      while (end < row.length && row[end] === key) end += 1;
      const color = map.palette[key];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(left + rx * px, top + ry * px, (end - rx) * px + 0.5, px + 0.5);
      }
      rx = end;
    }
  });
  return { x: left, y: top, w: width * px, h: map.rows.length * px };
}

/** Draw a projected ground ellipse (circle in world space). */
function groundEllipse(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  x: number,
  y: number,
  r: number
): boolean {
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const p = project(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, cam, vp);
    if (!p) return false;
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.closePath();
  return true;
}

/** Draw a 5x5 glyph inside a small rounded badge. */
function badge(
  ctx: CanvasRenderingContext2D,
  glyph: readonly string[],
  cx: number,
  cy: number,
  px: number,
  fg: string,
  bg: string
): void {
  const size = 9 * px;
  ctx.fillStyle = bg;
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  ctx.fillStyle = fg;
  glyph.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] === "X") {
        ctx.fillRect(cx - 2.5 * px + gx * px, cy - 2.5 * px + gy * px, px + 0.5, px + 0.5);
      }
    }
  });
}

/** Render the floor: far rows first, raised walls drawn in the same pass. */
function drawGround(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const kind = tileAt(x, y);
      if (kind === "wall") {
        wallFace(ctx, cam, vp, x, y);
        if (quad(ctx, cam, vp, x, y, x + 1, y + 1, WALL_H)) {
          ctx.fillStyle = WALL_TOP;
          ctx.fill();
        }
        continue;
      }
      if (!quad(ctx, cam, vp, x, y, x + 1, y + 1)) continue;
      ctx.fillStyle = FLOOR[kind][(x + y) % 2 === 0 ? 0 : 1];
      ctx.fill();
      ctx.strokeStyle = GRID_LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/** Zone name chips, drawn above the agents so crowded rooms never hide them. */
function drawZoneLabels(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  labels: Record<RoomZoneId, string>
): void {
  ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = "middle";
  for (const z of ZONE_AREAS) {
    const p = project(z.x + 0.2, z.y + 0.2, cam, vp);
    if (!p) continue;
    const text = labels[z.id].toUpperCase();
    const w = ctx.measureText(text).width + 16;
    const x = Math.max(6, p.sx);
    const y = Math.max(6, p.sy - 10);
    ctx.fillStyle = "rgba(11, 12, 15, 0.82)";
    ctx.fillRect(x, y, w, 20);
    ctx.fillStyle = ZONE_GLOW[z.id];
    ctx.fillRect(x, y, 2, 20);
    ctx.fillText(text, x + 9, y + 10.5);
  }
}

/** Sprite bob offset in sprite pixels for the current activity. */
function bobOffset(e: WorldEntity, t: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  if (isMoving(e)) return Math.floor(t / 0.15) % 2;
  if (e.activity === "working") return Math.floor(t / 0.4) % 2;
  if (e.activity === "thinking") return Math.floor(t / 0.9) % 2;
  return 0;
}

/** Draw one agent billboard and its decorations; returns its hit box. */
function drawEntity(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  e: WorldEntity,
  opts: DrawOptions
): HitBox | null {
  const p = project(e.x, e.y, cam, vp);
  if (!p) return null;
  const px = p.scale * SPRITE_PX;
  const def = SPRITE_DEFINITIONS[e.variant];
  const selected = opts.selectedId === e.id;
  const hovered = opts.hoveredId === e.id;

  // Ground: shadow, ownership ring, selection ring.
  if (groundEllipse(ctx, cam, vp, e.x, e.y, 0.32)) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fill();
  }
  if (groundEllipse(ctx, cam, vp, e.x, e.y, 0.42)) {
    ctx.lineWidth = Math.max(1, 1.5 * p.scale * 2);
    if (e.source === "live") {
      ctx.strokeStyle = POOL_MARKER[def.pool] ?? "#8c93a0";
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "#b3b9c4";
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 3]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  if ((selected || hovered) && groundEllipse(ctx, cam, vp, e.x, e.y, 0.55)) {
    ctx.strokeStyle = selected ? "#ff8a3d" : "rgba(255, 138, 61, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Sprite.
  const bob = bobOffset(e, opts.timeSec, opts.reducedMotion) * px;
  const left = p.sx - (SPRITE_GRID / 2) * px;
  const top = p.sy - SPRITE_GRID * px - bob;
  ctx.globalAlpha = e.activity === "paused" ? 0.45 : 1;
  for (const r of buildSpriteRects(e.variant)) {
    const color = def.palette[r.role];
    if (!color || r.role === "S") continue;
    const rx = e.facing === "left" ? SPRITE_GRID - r.x - r.width : r.x;
    ctx.fillStyle = color;
    ctx.fillRect(left + rx * px, top + r.y * px, r.width * px + 0.5, px + 0.5);
  }
  ctx.globalAlpha = 1;

  // Activity badge above the head.
  const headY = top - 5 * px;
  const t = opts.timeSec;
  switch (e.activity) {
    case "thinking": {
      ctx.fillStyle = "#d3d7de";
      const lit = opts.reducedMotion ? 3 : (Math.floor(t / 0.35) % 3) + 1;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < lit ? 1 : 0.3;
        ctx.fillRect(p.sx - 3.5 * px + i * 3 * px, headY, px * 1.5, px * 1.5);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "waiting":
      badge(ctx, GLYPHS.question as string[], p.sx, headY, px, "#15171b", "#f2c14e");
      break;
    case "paused":
      badge(ctx, GLYPHS.pause as string[], p.sx, headY, px, "#e8eaee", "#373c44");
      break;
    case "done":
      badge(ctx, GLYPHS.check as string[], p.sx, headY, px, "#0b0c0f", "#3ddc97");
      break;
    case "error":
      badge(ctx, GLYPHS.bang as string[], p.sx, headY, px, "#ffffff", "#ff5d5d");
      break;
    case "working":
      if (!opts.reducedMotion && !isMoving(e) && Math.floor(t / 0.2) % 3 !== 0) {
        ctx.fillStyle = "#ffa466";
        const sx = p.sx + (Math.floor(t / 0.2) % 2 ? 4 : -5) * px;
        ctx.fillRect(sx, p.sy - 8 * px, px, px);
      }
      break;
    default:
      break;
  }

  // Name tag for the selected / hovered agent.
  if (selected || hovered) {
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    const label = e.name.length > 28 ? `${e.name.slice(0, 27)}…` : e.name;
    const w = ctx.measureText(label).width + 12;
    const tagY = headY - 22;
    ctx.fillStyle = "rgba(14, 15, 18, 0.92)";
    ctx.fillRect(p.sx - w / 2, tagY, w, 18);
    ctx.strokeStyle = selected ? "#ff8a3d" : "#2f343c";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.sx - w / 2 + 0.5, tagY + 0.5, w - 1, 17);
    ctx.fillStyle = "#f5f6f8";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.sx - w / 2 + 6, tagY + 9.5);
  }

  return { id: e.id, x: left, y: top, w: SPRITE_GRID * px, h: SPRITE_GRID * px + bob };
}

/** Draw a prop billboard. */
function drawProp(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, prop: Prop): void {
  const p = project(prop.x, prop.y, cam, vp);
  if (!p) return;
  const px = p.scale * SPRITE_PX;
  let map: PixelMap;
  if (prop.kind === "desk") {
    const kind = tileAt(Math.floor(prop.x), Math.floor(prop.y));
    map = deskMap((kind in ZONE_GLOW ? kind : "conductor") as RoomZoneId);
  } else {
    map = PROP_MAPS[prop.kind];
  }
  drawPixelMap(ctx, map, p.sx, p.sy, px);
}

/**
 * Render one frame.
 *
 * @param ctx - 2D context (already scaled for device pixel ratio).
 * @param vp - Viewport in CSS pixels.
 * @param cam - Camera.
 * @param entities - Agents to draw.
 * @param opts - Selection, hover, time, motion, and labels.
 * @returns Hit boxes in draw order (nearest last).
 */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cam: Camera,
  entities: readonly WorldEntity[],
  opts: DrawOptions
): HitBox[] {
  ctx.imageSmoothingEnabled = false;
  const sky = ctx.createLinearGradient(0, 0, 0, vp.height);
  sky.addColorStop(0, "#0b0c0f");
  sky.addColorStop(1, "#15171b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, vp.width, vp.height);

  drawGround(ctx, cam, vp);

  type Drawable = { y: number; prop?: Prop; entity?: WorldEntity };
  const items: Drawable[] = [
    ...PROPS.map((prop) => ({ y: prop.y, prop })),
    ...entities.map((entity) => ({ y: entity.y, entity })),
  ];
  items.sort((a, b) => a.y - b.y);

  const hits: HitBox[] = [];
  for (const item of items) {
    if (item.prop) drawProp(ctx, cam, vp, item.prop);
    else if (item.entity) {
      const hit = drawEntity(ctx, cam, vp, item.entity, opts);
      if (hit) hits.push(hit);
    }
  }
  drawZoneLabels(ctx, cam, vp, opts.zoneLabels);
  return hits;
}

/**
 * Find the nearest entity under a screen point.
 *
 * @param hits - Hit boxes from {@link drawWorld}.
 * @param sx - Screen x.
 * @param sy - Screen y.
 * @returns The entity id, or null.
 */
export function hitTest(hits: readonly HitBox[], sx: number, sy: number): string | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i] as HitBox;
    if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h.id;
  }
  return null;
}
