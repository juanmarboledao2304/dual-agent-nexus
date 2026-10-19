/**
 * @file NexusMark.tsx
 * @description The DualAgent Nexus 8-bit app mark: one 16x16 character split down the middle,
 * warm crimson/orange on the Claude side and cool violet/cyan on the Antigravity side. The same
 * pixel map backs `client/public/nexus-icon.svg` (the favicon), exported here as
 * `NEXUS_MARK_SVG` so the two can never drift apart.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const ROWS = [
  "................",
  ".......AA.......",
  "......AAAA......",
  "...LLLLLLLLLL...",
  "...BBBBBBBBBB...",
  "...BBEBBBBEBB...",
  "...BBEBBBBEBB...",
  ".BBBBBBBBBBBBBB.",
  "...BBBBBBBBBB...",
  "...BBBBBBBBBB...",
  "...DDDDDDDDDD...",
  "...D.D....D.D...",
  "...D.D....D.D...",
  "................",
  "..WWWWWW.CCCCCC.",
  "................",
] as const;

const BACKGROUND = "#0b1020";
const WARM: Record<string, string> = {
  A: "#fbbf24",
  L: "#f97316",
  B: "#ef4444",
  D: "#991b1b",
  E: BACKGROUND,
  W: "#f97316",
  C: "#22d3ee",
};
const COOL: Record<string, string> = {
  A: "#22d3ee",
  L: "#22d3ee",
  B: "#a855f7",
  D: "#6b21a8",
  E: BACKGROUND,
  W: "#f97316",
  C: "#22d3ee",
};

/** One run of same-colored pixels. */
interface MarkRect {
  x: number;
  y: number;
  width: number;
  fill: string;
}

/** Rasterize the mark into color runs; the left eight columns are warm, the right eight cool. */
function buildMarkRects(): MarkRect[] {
  const rects: MarkRect[] = [];
  ROWS.forEach((row, y) => {
    let x = 0;
    const fillAt = (col: number) => (col < 8 ? WARM : COOL)[row.charAt(col)];
    while (x < row.length) {
      const fill = fillAt(x);
      if (!fill) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && fillAt(end) === fill) end += 1;
      rects.push({ x, y, width: end - x, fill });
      x = end;
    }
  });
  return rects;
}

const MARK_RECTS = buildMarkRects();

/** Standalone SVG markup of the mark, identical to `client/public/nexus-icon.svg`. */
export const NEXUS_MARK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">',
  `<rect width="16" height="16" rx="2" fill="${BACKGROUND}"/>`,
  ...MARK_RECTS.map(
    (r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="1" fill="${r.fill}"/>`
  ),
  "</svg>",
].join("");

/** Props for {@link NexusMark}. */
interface NexusMarkProps {
  size?: number;
  className?: string;
}

/**
 * Render the DualAgent Nexus app mark inline.
 *
 * @param props - See {@link NexusMarkProps}.
 * @returns The SVG mark.
 */
export function NexusMark({ size = 32, className = "" }: NexusMarkProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="DualAgent Nexus"
      className={`pixel-sprite flex-shrink-0 ${className}`}
    >
      <rect width={16} height={16} rx={2} fill={BACKGROUND} />
      {MARK_RECTS.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.width} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
