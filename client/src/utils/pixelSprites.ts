/**
 * @file pixelSprites.ts
 * @description Deterministic 8-bit sprite data for the DualAgent Nexus PixelAvatar engine.
 * Every agent resolves to one of eight 16x16 character sprites drawn from its quota pool and
 * model tier: Pool 3 Claude Direct (warm spectrum), Pool 1 AGY-Claude (hybrid spectrum with
 * Antigravity orbital frame accents), and Pool 2 AGY-Gemini (cool spectrum with a dual-core
 * chest). Sprites are plain character maps so they stay reviewable as text and render as
 * run-length-merged SVG rects under `shape-rendering="crispEdges"`. Also maps an agent's
 * lifecycle and current tool to an avatar state and a short geometric status badge.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import type { ModelTier, ThermalProvider } from "./agentTheme";

/** Side length of every sprite grid, in pixels. */
export const SPRITE_GRID = 16;

/** The eight character sprites, one per pool and tier. */
export type SpriteVariant =
  | "claude-opus"
  | "claude-sonnet"
  | "claude-haiku"
  | "agy-opus"
  | "agy-sonnet"
  | "gemini-argon"
  | "gemini-pro"
  | "gemini-flash";

/** Quota pool a sprite belongs to. */
export type SpritePool = "agy-claude" | "agy-gemini" | "claude-direct";

/** Animation and badge state an avatar renders in. */
export type PixelAvatarState =
  | "idle"
  | "thinking"
  | "working"
  | "waiting_approval"
  | "completed"
  | "error";

/**
 * Pixel roles used in sprite maps:
 * `.` transparent, `B` body, `D` shade, `L` highlight, `E` eye, `A` accent,
 * `H` headset, `C` core, `R` orbital frame, `S` ground shadow.
 */
export type PixelRole = "B" | "D" | "L" | "E" | "A" | "H" | "C" | "R" | "S";

/** Palette for one sprite: a fill per pixel role it uses. */
export type SpritePalette = Partial<Record<PixelRole, string>>;

/** Static description of one sprite variant. */
export interface SpriteDefinition {
  variant: SpriteVariant;
  pool: SpritePool;
  tier: ModelTier;
  /** Human-readable character name, e.g. "Opus Conductor". */
  label: string;
  /** Pool pill text, e.g. "POOL 3 • CLAUDE DIRECT". */
  poolLabel: string;
  /** Primary chassis color; drives frames, glows, and legend swatches. */
  primaryHex: string;
  palette: SpritePalette;
  /** 16 rows of 16 pixel-role characters. */
  rows: readonly string[];
}

/** One horizontal run of same-colored pixels, ready to render as an SVG rect. */
export interface SpriteRect {
  x: number;
  y: number;
  width: number;
  role: PixelRole;
}

const EMPTY = "................";

// Shared lower body for the full-size Claude silhouette (rows 3-13).
const CLAUDE_BODY = [
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
  "....SSSSSSSS....",
] as const;

const SPRITE_ROWS: Record<SpriteVariant, readonly string[]> = {
  // Pool 3 heavy: crimson chassis, gold crest and command visor.
  "claude-opus": [
    EMPTY,
    ".......AA.......",
    "......AAAA......",
    "...LLLLLLLLLL...",
    "...BBBBBBBBBB...",
    "...AAAAAAAAAA...",
    ".BBAEEAAAAEEABB.",
    ".BBAAAAAAAAAABB.",
    "...BBBBBBBBBB...",
    "...BBBBBBBBBB...",
    "...DDDDDDDDDD...",
    "...D.D....D.D...",
    "...D.D....D.D...",
    "....SSSSSSSS....",
    EMPTY,
    EMPTY,
  ],
  // Pool 3 standard: orange chassis with a technical headset and mic boom.
  "claude-sonnet": [
    EMPTY,
    EMPTY,
    "...HHHHHHHHHH...",
    "..HLLLLLLLLLLH..",
    "..HBBBBBBBBBBH..",
    ".HHBBEBBBBEBBHH.",
    ".HHBBEBBBBEBBHH.",
    "..AAABBBBBBBB...",
    ".BBBBBBBBBBBBBB.",
    "...BBBBBBBBBB...",
    "...DDDDDDDDDD...",
    "...D.D....D.D...",
    "...D.D....D.D...",
    "....SSSSSSSS....",
    EMPTY,
    EMPTY,
  ],
  // Pool 3 light: compact amber scout with a single sensor antenna.
  "claude-haiku": [
    EMPTY,
    EMPTY,
    EMPTY,
    ".......A........",
    ".......D........",
    "....LLLLLLLL....",
    "....BBBBBBBB....",
    "....BEBBBBEB....",
    "..BBBBBBBBBBBB..",
    "....BBBBBBBB....",
    "....BBBBBBBB....",
    "....DDDDDDDD....",
    "....D.D..D.D....",
    ".....SSSSSS.....",
    EMPTY,
    EMPTY,
  ],
  // Pool 1 heavy: fuchsia Claude chassis inside an Antigravity orbital frame.
  "agy-opus": [
    "RR............RR",
    "R......AA......R",
    "......AAAA......",
    ...CLAUDE_BODY.slice(0, 6),
    "RR.BBBBBBBBBB.RR",
    ...CLAUDE_BODY.slice(7),
    "R..............R",
    "RR............RR",
  ],
  // Pool 1 standard: indigo Claude chassis, single antenna, orbital frame.
  "agy-sonnet": [
    "RR............RR",
    "R.......A......R",
    "........D.......",
    ...CLAUDE_BODY.slice(0, 6),
    "RR.BBBBBBBBBB.RR",
    ...CLAUDE_BODY.slice(7),
    "R..............R",
    "RR............RR",
  ],
  // Pool 2 heavy: violet chassis, twin antennas, cyan diamond core.
  "gemini-argon": [
    EMPTY,
    "....C......C....",
    "....D......D....",
    "...LLLLLLLLLL...",
    "...BBBBBBBBBB...",
    "...BBEBBBBEBB...",
    "...BBEBBBBEBB...",
    ".BBBBBBCCBBBBBB.",
    "...BBBCCCCBBB...",
    "...BBBBCCBBBB...",
    "...DDDDDDDDDD...",
    "...D.D....D.D...",
    "...D.D....D.D...",
    "....SSSSSSSS....",
    EMPTY,
    EMPTY,
  ],
  // Pool 2 standard: sapphire chassis, twin antennas, square core.
  "gemini-pro": [
    EMPTY,
    "....C......C....",
    "....D......D....",
    "...LLLLLLLLLL...",
    "...BBBBBBBBBB...",
    "...BBEBBBBEBB...",
    "...BBEBBBBEBB...",
    ".BBBBBBBBBBBBBB.",
    "...BBBBCCBBBB...",
    "...BBBBCCBBBB...",
    "...DDDDDDDDDD...",
    "...D.D....D.D...",
    "...D.D....D.D...",
    "....SSSSSSSS....",
    EMPTY,
    EMPTY,
  ],
  // Pool 2 light: compact emerald fan-out specialist with a diamond core.
  "gemini-flash": [
    EMPTY,
    EMPTY,
    EMPTY,
    ".....C....C.....",
    ".....D....D.....",
    "....LLLLLLLL....",
    "....BBBBBBBB....",
    "....BEBBBBEB....",
    "..BBBBBCCBBBBB..",
    "....BBCCCCBB....",
    "....BBBCCBBB....",
    "....DDDDDDDD....",
    "....D.D..D.D....",
    ".....SSSSSS.....",
    EMPTY,
    EMPTY,
  ],
};

const SHADOW = "rgba(2,6,23,0.55)";

/** Every sprite variant with its palette, pool, and label. */
export const SPRITE_DEFINITIONS: Record<SpriteVariant, SpriteDefinition> = {
  "claude-opus": {
    variant: "claude-opus",
    pool: "claude-direct",
    tier: "heavy",
    label: "Opus Conductor",
    poolLabel: "POOL 3 • CLAUDE DIRECT",
    primaryHex: "#ef4444",
    palette: { B: "#ef4444", D: "#991b1b", L: "#f87171", E: "#1c0a0a", A: "#fbbf24", S: SHADOW },
    rows: SPRITE_ROWS["claude-opus"],
  },
  "claude-sonnet": {
    variant: "claude-sonnet",
    pool: "claude-direct",
    tier: "standard",
    label: "Sonnet Engineer",
    poolLabel: "POOL 3 • CLAUDE DIRECT",
    primaryHex: "#f97316",
    palette: {
      B: "#f97316",
      D: "#9a3412",
      L: "#fb923c",
      E: "#1c0a03",
      H: "#334155",
      A: "#e2e8f0",
      S: SHADOW,
    },
    rows: SPRITE_ROWS["claude-sonnet"],
  },
  "claude-haiku": {
    variant: "claude-haiku",
    pool: "claude-direct",
    tier: "light",
    label: "Haiku Scout",
    poolLabel: "POOL 3 • CLAUDE DIRECT",
    primaryHex: "#eab308",
    palette: { B: "#eab308", D: "#854d0e", L: "#facc15", E: "#1a1405", A: "#fef08a", S: SHADOW },
    rows: SPRITE_ROWS["claude-haiku"],
  },
  "agy-opus": {
    variant: "agy-opus",
    pool: "agy-claude",
    tier: "heavy",
    label: "Opus 5.5 Thinking",
    poolLabel: "POOL 1 • AGY-CLAUDE",
    primaryHex: "#d946ef",
    palette: {
      B: "#d946ef",
      D: "#86198f",
      L: "#e879f9",
      E: "#1a0520",
      A: "#f5d0fe",
      R: "#22d3ee",
      S: SHADOW,
    },
    rows: SPRITE_ROWS["agy-opus"],
  },
  "agy-sonnet": {
    variant: "agy-sonnet",
    pool: "agy-claude",
    tier: "standard",
    label: "Sonnet 5.5 / GPT-OSS",
    poolLabel: "POOL 1 • AGY-CLAUDE",
    primaryHex: "#6366f1",
    palette: {
      B: "#6366f1",
      D: "#3730a3",
      L: "#818cf8",
      E: "#0b0b2a",
      A: "#c7d2fe",
      R: "#22d3ee",
      S: SHADOW,
    },
    rows: SPRITE_ROWS["agy-sonnet"],
  },
  "gemini-argon": {
    variant: "gemini-argon",
    pool: "agy-gemini",
    tier: "heavy",
    label: "Argon 4 Ultra",
    poolLabel: "POOL 2 • AGY-GEMINI",
    primaryHex: "#a855f7",
    palette: { B: "#a855f7", D: "#6b21a8", L: "#c084fc", E: "#12052a", C: "#22d3ee", S: SHADOW },
    rows: SPRITE_ROWS["gemini-argon"],
  },
  "gemini-pro": {
    variant: "gemini-pro",
    pool: "agy-gemini",
    tier: "standard",
    label: "Gemini Pro",
    poolLabel: "POOL 2 • AGY-GEMINI",
    primaryHex: "#3b82f6",
    palette: { B: "#3b82f6", D: "#1e40af", L: "#60a5fa", E: "#06122b", C: "#bae6fd", S: SHADOW },
    rows: SPRITE_ROWS["gemini-pro"],
  },
  "gemini-flash": {
    variant: "gemini-flash",
    pool: "agy-gemini",
    tier: "light",
    label: "Gemini 3.8 Flash",
    poolLabel: "POOL 2 • AGY-GEMINI",
    primaryHex: "#10b981",
    palette: { B: "#10b981", D: "#065f46", L: "#34d399", E: "#03140e", C: "#a7f3d0", S: SHADOW },
    rows: SPRITE_ROWS["gemini-flash"],
  },
};

/** Sprite variants in legend order: Pool 1, Pool 2, Pool 3; heavy to light. */
export const SPRITE_VARIANT_ORDER: readonly SpriteVariant[] = [
  "agy-opus",
  "agy-sonnet",
  "gemini-argon",
  "gemini-pro",
  "gemini-flash",
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
];

const spriteRectCache = new Map<SpriteVariant, SpriteRect[]>();

/**
 * Merge each sprite row into horizontal runs of identical pixel roles, so a sprite renders as a
 * few dozen rects instead of up to 256. Results are cached per variant.
 *
 * @param variant - Sprite to rasterize.
 * @returns Runs in row-major order; transparent pixels are omitted.
 */
export function buildSpriteRects(variant: SpriteVariant): SpriteRect[] {
  const cached = spriteRectCache.get(variant);
  if (cached) return cached;
  const rects: SpriteRect[] = [];
  SPRITE_DEFINITIONS[variant].rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === ".") {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      rects.push({ x, y, width: end - x, role: ch as PixelRole });
      x = end;
    }
  });
  spriteRectCache.set(variant, rects);
  return rects;
}

/**
 * Pick the sprite for an agent from its resolved thermal provider and model tier. Codex and
 * Cursor rows (outside the three operational pools) fall back to the Claude Direct sprites.
 *
 * @param provider - Thermal provider from `getAgentThermalTheme`.
 * @param tier - Model tier from `getAgentThermalTheme`.
 * @returns The matching sprite variant.
 */
export function resolveSpriteVariant(
  provider: ThermalProvider | string,
  tier: ModelTier
): SpriteVariant {
  if (provider === "agy-claude") return tier === "heavy" ? "agy-opus" : "agy-sonnet";
  if (provider === "antigravity" || provider === "agy-gemini") {
    if (tier === "heavy") return "gemini-argon";
    if (tier === "light") return "gemini-flash";
    return "gemini-pro";
  }
  if (tier === "heavy") return "claude-opus";
  if (tier === "light") return "claude-haiku";
  return "claude-sonnet";
}

/** Minimal agent shape the state resolver reads. */
export interface AvatarStateInput {
  status?: string | null;
  telemetry_status?: string | null;
  current_tool?: string | null;
  awaiting_input_since?: string | null;
  awaiting_reason?: string | null;
}

/**
 * Whether an agent is blocked on an interactive confirmation (a permission prompt or other
 * blocking notification). Waits stamped by `stop` / `session_start` only mean the session is
 * idle between turns, so they do not count.
 *
 * @param agent - Agent row (or a partial with the fields above).
 * @returns True while the agent needs a y/n style approval.
 */
export function isAwaitingApproval(agent: AvatarStateInput | null | undefined): boolean {
  if (!agent) return false;
  const status = String(agent.status || "").toLowerCase();
  if (status === "completed" || status === "error") return false;
  if (String(agent.telemetry_status || "").toLowerCase() === "waiting_approval") return true;
  return Boolean(agent.awaiting_input_since) && agent.awaiting_reason === "notification";
}

/**
 * Map an agent's lifecycle to an avatar state. Approval waits win over everything except a
 * finished lifecycle; a working agent with no active tool is thinking.
 *
 * @param agent - Agent row (or a partial with the fields above).
 * @returns The avatar state to render.
 */
export function resolveAvatarState(agent: AvatarStateInput | null | undefined): PixelAvatarState {
  if (!agent) return "idle";
  const status = String(agent.status || "").toLowerCase();
  const telemetry = String(agent.telemetry_status || "").toLowerCase();
  if (status === "error" || telemetry === "error") return "error";
  if (status === "completed") return "completed";
  if (isAwaitingApproval(agent)) return "waiting_approval";
  if (status === "working") {
    if (telemetry === "thinking" || telemetry === "spawning") return "thinking";
    return agent.current_tool || telemetry === "tool_use" ? "working" : "thinking";
  }
  return "idle";
}

const TOOL_BADGES: Array<[RegExp, string]> = [
  [/^(task|agent|invoke_subagent|define_subagent)$/i, "FAN-OUT"],
  [/^git( |$)/i, "GIT"],
  [/^(bash|run_command|powershell|shell|exec)$/i, "BASH"],
  [/^(read|view_file|view_file_outline|notebookread|read_file)$/i, "READ"],
  [/^(edit|write|multiedit|notebookedit|replace_file_content|write_to_file|apply_patch)$/i, "EDIT"],
  [/^(grep|glob|ls|grep_search|find_by_name|codebase_search|search)$/i, "GREP"],
  [/^(webfetch|websearch|read_url_content|search_web)$/i, "WEB"],
  [/^mcp__/i, "MCP"],
];

/**
 * Compress a tool name into a short uppercase status badge (`BASH`, `READ`, `EDIT`, `GREP`,
 * `FAN-OUT`, ...). Unknown tools keep their first eight alphanumeric characters.
 *
 * @param tool - Raw tool name from the agent row or a hook event.
 * @returns Badge text, or null when there is no tool.
 */
export function toolBadgeLabel(tool: string | null | undefined): string | null {
  const raw = String(tool || "").trim();
  if (!raw) return null;
  for (const [re, label] of TOOL_BADGES) {
    if (re.test(raw)) return label;
  }
  const compact = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return compact ? compact.slice(0, 8) : null;
}

/**
 * Badge text for an avatar state, or null when the state shows no badge.
 *
 * @param state - Avatar state.
 * @param tool - Current tool, used for the working badge.
 * @param hasDigest - Whether the agent returned a `===DIGEST===` block.
 * @returns Badge text or null.
 */
export function avatarBadgeLabel(
  state: PixelAvatarState,
  tool?: string | null,
  hasDigest = false
): string | null {
  switch (state) {
    case "working":
      return toolBadgeLabel(tool) ?? "WORKING";
    case "waiting_approval":
      return "APPROVAL REQUIRED";
    case "completed":
      return hasDigest ? "DIGEST" : "DONE";
    case "error":
      return "ERROR";
    default:
      return null;
  }
}
