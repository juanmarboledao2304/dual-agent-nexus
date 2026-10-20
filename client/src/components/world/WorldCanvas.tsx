/**
 * @file WorldCanvas.tsx
 * @description Interactive canvas for the Agent World. Runs the animation loop
 * (stepping movement and sandbox behavior), owns the camera (drag to pan, wheel
 * or +/- to zoom, WASD/arrows to move, 0 to recenter), resolves clicks to agent
 * selection, and lets sandbox agents be dragged to a new spot. Live agents can
 * only be selected. Degrades to an empty frame when 2D canvas is unavailable.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { RoomZoneId } from "../../utils/agentRooms";
import { CAM_BACK, CAM_HEIGHT, FOCAL, clampZoom, unproject } from "../../utils/world/projection";
import type { Camera, Viewport } from "../../utils/world/projection";
import { MAP_H, MAP_W, isWalkable } from "../../utils/world/worldMap";
import { advanceSandboxEntity, stepEntity } from "../../utils/world/entities";
import type { WorldEntity } from "../../utils/world/entities";
import { drawWorld, hitTest } from "./drawWorld";
import type { HitBox } from "./drawWorld";

/** Props for {@link WorldCanvas}. */
export interface WorldCanvasProps {
  /** Live simulation state, mutated by the loop; the page writes data updates into it. */
  entitiesRef: MutableRefObject<Map<string, WorldEntity>>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called when a sandbox agent is dropped at a new spot (tiles). */
  onMoveSandbox: (id: string, x: number, y: number) => void;
  reducedMotion: boolean;
  zoneLabels: Record<RoomZoneId, string>;
  /** Changing this value recenters the camera. */
  recenterKey: number;
  /** Accessible description of the canvas. */
  label: string;
}

/** Default framing: slightly south of center so the nearer rooms are not clipped. */
const DEFAULT_CAMERA: Camera = { x: MAP_W / 2, y: MAP_H / 2 + 1, zoom: 1.4 };
/** Pointer travel (px) below which a press counts as a click. */
const CLICK_SLOP = 4;
/** Keyboard pan step in tiles. */
const KEY_STEP = 0.5;

type Gesture =
  | { kind: "pan"; startX: number; startY: number; cam: Camera; moved: boolean }
  | { kind: "drag"; id: string; startX: number; startY: number; moved: boolean }
  | null;

/** Keep the camera's look-at point over the map. */
function clampCamera(c: Camera): Camera {
  return {
    x: Math.min(MAP_W, Math.max(0, c.x)),
    y: Math.min(MAP_H, Math.max(0, c.y)),
    zoom: clampZoom(c.zoom),
  };
}

/**
 * Canvas element plus its animation loop. Selection lives in the page; camera, hover, and
 * gestures live in refs so the 60fps loop never re-renders React.
 */
export function WorldCanvas({
  entitiesRef,
  selectedId,
  onSelect,
  onMoveSandbox,
  reducedMotion,
  zoneLabels,
  recenterKey,
  label,
}: WorldCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA });
  const vpRef = useRef<Viewport>({ width: 0, height: 0 });
  const hitsRef = useRef<HitBox[]>([]);
  const hoverRef = useRef<string | null>(null);
  const gestureRef = useRef<Gesture>(null);
  // Latest props for the long-lived loop and listeners.
  const propsRef = useRef({ selectedId, reducedMotion, zoneLabels, onSelect, onMoveSandbox });
  propsRef.current = { selectedId, reducedMotion, zoneLabels, onSelect, onMoveSandbox };

  useEffect(() => {
    camRef.current = { ...DEFAULT_CAMERA };
  }, [recenterKey]);

  // Size the backing store to the container and device pixel ratio.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      vpRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(container);
    window.addEventListener("resize", resize);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Animation loop: step the simulation, then draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx || typeof window.requestAnimationFrame !== "function") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { reducedMotion: rm, selectedId: sel, zoneLabels: labels } = propsRef.current;
      const map = entitiesRef.current;
      const dragging = gestureRef.current?.kind === "drag" ? gestureRef.current.id : null;
      for (const [id, e] of map) {
        if (id === dragging) continue;
        const next = advanceSandboxEntity(stepEntity(e, dt, rm), t);
        if (next !== e) map.set(id, next);
      }
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hitsRef.current = drawWorld(ctx, vpRef.current, camRef.current, Array.from(map.values()), {
        selectedId: sel,
        hoveredId: hoverRef.current,
        timeSec: t,
        reducedMotion: rm,
        zoneLabels: labels,
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [entitiesRef]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const c = camRef.current;
      camRef.current = clampCamera({ ...c, zoom: c.zoom * (1 - ev.deltaY * 0.0015) });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  /** Pointer position relative to the canvas, in CSS pixels. */
  const localPoint = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPoint(ev);
    const id = hitTest(hitsRef.current, pt.x, pt.y);
    const entity = id ? entitiesRef.current.get(id) : undefined;
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    gestureRef.current =
      entity?.source === "sandbox"
        ? { kind: "drag", id: entity.id, startX: pt.x, startY: pt.y, moved: false }
        : { kind: "pan", startX: pt.x, startY: pt.y, cam: { ...camRef.current }, moved: false };
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = localPoint(ev);
    const g = gestureRef.current;
    if (!g) {
      const hover = hitTest(hitsRef.current, pt.x, pt.y);
      hoverRef.current = hover;
      const hoveredEntity = hover ? entitiesRef.current.get(hover) : undefined;
      ev.currentTarget.style.cursor = hoveredEntity
        ? hoveredEntity.source === "sandbox"
          ? "grab"
          : "pointer"
        : "default";
      return;
    }
    const dx = pt.x - g.startX;
    const dy = pt.y - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    g.moved = true;
    if (g.kind === "pan") {
      const f = FOCAL * g.cam.zoom;
      const pxPerTileX = f / CAM_BACK;
      const pxPerTileY = (CAM_HEIGHT * f) / (CAM_BACK * CAM_BACK);
      camRef.current = clampCamera({
        ...g.cam,
        x: g.cam.x - dx / pxPerTileX,
        y: g.cam.y - dy / pxPerTileY,
      });
      ev.currentTarget.style.cursor = "grabbing";
    } else {
      const w = unproject(pt.x, pt.y, camRef.current, vpRef.current);
      const e = entitiesRef.current.get(g.id);
      if (w && e) entitiesRef.current.set(g.id, { ...e, x: w.wx, y: w.wy, tx: w.wx, ty: w.wy });
      ev.currentTarget.style.cursor = "grabbing";
    }
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    ev.currentTarget.releasePointerCapture?.(ev.pointerId);
    ev.currentTarget.style.cursor = "default";
    if (!g) return;
    const pt = localPoint(ev);
    if (!g.moved) {
      propsRef.current.onSelect(hitTest(hitsRef.current, pt.x, pt.y));
      return;
    }
    if (g.kind === "drag") {
      const e = entitiesRef.current.get(g.id);
      if (!e) return;
      if (isWalkable(e.x, e.y)) {
        propsRef.current.onMoveSandbox(g.id, e.x, e.y);
      } else {
        // Dropped on a wall: walk back home.
        entitiesRef.current.set(g.id, { ...e, tx: e.homeX, ty: e.homeY, activity: "walking" });
      }
    }
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLCanvasElement>) => {
    const c = camRef.current;
    let next: Camera | null = null;
    switch (ev.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        next = { ...c, x: c.x - KEY_STEP };
        break;
      case "ArrowRight":
      case "d":
      case "D":
        next = { ...c, x: c.x + KEY_STEP };
        break;
      case "ArrowUp":
      case "w":
      case "W":
        next = { ...c, y: c.y - KEY_STEP };
        break;
      case "ArrowDown":
      case "s":
      case "S":
        next = { ...c, y: c.y + KEY_STEP };
        break;
      case "+":
      case "=":
        next = { ...c, zoom: c.zoom * 1.1 };
        break;
      case "-":
        next = { ...c, zoom: c.zoom / 1.1 };
        break;
      case "0":
        next = { ...DEFAULT_CAMERA };
        break;
      case "Escape":
        propsRef.current.onSelect(null);
        return;
      default:
        return;
    }
    ev.preventDefault();
    camRef.current = clampCamera(next);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl">
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={label}
        aria-roledescription="interactive map"
        tabIndex={0}
        className="block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gestureRef.current = null;
        }}
        onPointerLeave={() => {
          if (!gestureRef.current) hoverRef.current = null;
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
