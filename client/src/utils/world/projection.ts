/**
 * @file projection.ts
 * @description Ground-plane perspective camera for the Agent World. Projects tile
 * coordinates to canvas pixels (and back) the way 3/4-view handheld RPGs frame a
 * map: the camera sits south of and above its look-at point, looking steeply
 * down and north, so far rows shrink toward a horizon while sprites stay upright.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

/** Camera state. `x`/`y` is the tile the camera looks at; `zoom` scales the focal length. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Canvas size in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** World pixels per tile. */
export const TILE = 48;
/** Focal length in screen pixels at zoom 1. */
export const FOCAL = 620;
/** Camera height above the ground, in tiles (a steep, near top-down pitch). */
export const CAM_HEIGHT = 31;
/** Camera distance south of the look-at point, in tiles. */
export const CAM_BACK = 30;
/** Near clipping distance, in tiles. */
export const NEAR = 1.2;
/** Far clamp used when unprojecting, in tiles. */
export const FAR = 60;
/** Zoom limits. */
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 1.8;

/**
 * Screen y of the horizon, chosen so the camera's look-at point always projects to the vertical
 * center of the viewport (zoom then scales around the center). It is usually above the canvas.
 *
 * @param cam - Camera.
 * @param vp - Viewport.
 * @returns Horizon y in CSS pixels.
 */
export function horizonY(cam: Camera, vp: Viewport): number {
  return vp.height / 2 - (CAM_HEIGHT * FOCAL * cam.zoom) / CAM_BACK;
}

/** Result of projecting a ground point. `scale` is screen pixels per world pixel at that depth. */
export interface Projected {
  sx: number;
  sy: number;
  scale: number;
}

/**
 * Clamp a zoom value into the supported range.
 *
 * @param zoom - Requested zoom.
 * @returns Zoom within {@link MIN_ZOOM}..{@link MAX_ZOOM}.
 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Project a ground point (in tiles; y grows southward) to screen pixels.
 *
 * @param wx - World x in tiles.
 * @param wy - World y in tiles.
 * @param cam - Camera.
 * @param vp - Viewport.
 * @returns Screen position and scale, or null when the point is behind the near plane.
 */
export function project(wx: number, wy: number, cam: Camera, vp: Viewport): Projected | null {
  const dz = cam.y - wy + CAM_BACK;
  if (dz < NEAR) return null;
  const f = FOCAL * cam.zoom;
  const scale = f / (dz * TILE);
  return {
    sx: vp.width / 2 + (wx - cam.x) * TILE * scale,
    sy: horizonY(cam, vp) + CAM_HEIGHT * TILE * scale,
    scale,
  };
}

/**
 * Invert {@link project}: map a screen point back onto the ground plane. Depth is clamped to
 * {@link NEAR}..{@link FAR} so points near the horizon never produce infinities.
 *
 * @param sx - Screen x in CSS pixels.
 * @param sy - Screen y in CSS pixels.
 * @param cam - Camera.
 * @param vp - Viewport.
 * @returns World position in tiles, or null when the point is at or above the horizon.
 */
export function unproject(
  sx: number,
  sy: number,
  cam: Camera,
  vp: Viewport
): { wx: number; wy: number } | null {
  const horizon = horizonY(cam, vp);
  if (sy <= horizon + 0.5) return null;
  const f = FOCAL * cam.zoom;
  const dz = Math.min(FAR, Math.max(NEAR, (CAM_HEIGHT * f) / (sy - horizon)));
  const scale = f / (dz * TILE);
  return {
    wx: cam.x + (sx - vp.width / 2) / (TILE * scale),
    wy: cam.y + CAM_BACK - dz,
  };
}
