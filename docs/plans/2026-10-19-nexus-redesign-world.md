# Nexus Signal Redesign + Agent World Implementation Plan

**Goal:** Give DualAgent Nexus its own visual identity (new design system and app shell replacing the inherited sidebar layout) and add an interactive "Agent World": 8-bit agents in a pseudo-3D, 3/4-perspective tile world where live agents are shown read-only and sandbox agents can be created, paused, resumed, moved, and deleted.
**Architecture:** Tokens live in `client/tailwind.config.js` (Tailwind color remap) and `client/src/index.css` (component classes), so every page restyles without class churn. A new top-navigation shell (`client/src/components/shell/`) replaces `Sidebar.tsx`. The world is a canvas renderer driven by a pure engine module (`client/src/utils/world/`) plus a React page (`client/src/pages/AgentWorld.tsx`) that owns data loading and side panels.
**Tech stack:** React 19.2, Vite 7, Tailwind 3.4, react-router 8, i18next 26, Vitest 3 + Testing Library, jsdom 27. No new dependencies.
**Spec:** user request 2026-10-19 (redesign "more modern and understandable", own identity distinct from upstream Claude-Code-Agent-Monitor, Pokemon-style 3/4 perspective agent world with create/pause/delete; sandbox controls, live agents read-only; global redesign). Reference principles: Refero "Linear — midnight precision instrument" (hairline borders over shadows, restrained weights, one chromatic accent, three radii). Do not copy Linear's palette.

## Global Constraints
- Every new `.ts/.tsx/.css/.js` file starts with a header: `/** @file <name> @description <truthful overview> @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304) */`. Inherited files keep `@author Son Nguyen <hoangson091104@gmail.com>` unchanged, even when edited heavily or when code moves to a new file.
- UI is emoji-free (no emoji in copy, labels, or sprites). Use lucide-react icons.
- No Pokemon (or any third-party) assets, names, or tiles. All art is original procedural pixel art.
- Every user-visible string goes through i18next. New keys go to all five locales: `client/src/i18n/locales/{en,es,ko,vi,zh}/`.
- `localStorage` access always in try/catch; the app must work when it throws.
- Respect `prefers-reduced-motion: reduce` (no walking interpolation, no bobbing, no camera easing).
- Do not change API routes, WebSocket message types, or DB schema.
- `npm run verify` (repo root) must pass at the end. Snapshot diffs are reviewed, never blindly updated.
- Prettier formats everything (`npx prettier --write <files>`).

## Design Tokens
Neutral ramp "graphite" (replaces Tailwind `gray` AND `slate` in `theme.extend.colors`):
`50 #F5F6F8, 100 #E8EAEE, 200 #D3D7DE, 300 #B3B9C4, 400 #8C93A0, 500 #6A717D, 600 #4D535D, 700 #373C44, 800 #23272D, 900 #15171B, 950 #0B0C0F`
Surfaces: `surface-0 #08090B, surface-1 #0E0F12, surface-2 #131519, surface-3 #181B20, surface-4 #20242A, surface-5 #292E35`
Borders: `border #22262C, border-light #2F343C`
Accent "Ember" (single chromatic action color): `DEFAULT #FF8A3D, hover #FFA466, muted rgba(255,138,61,0.14)`; text on accent `#140A03`.
Pool colors (world + badges): Claude Direct `#FF8A3D`, AGY-Claude `#A78BFA`, AGY-Gemini `#5AB8FF`.
Status: success `#3DDC97`, warning `#F2C14E`, danger `#FF5D5D`, info `#5AB8FF`.
Type: Inter, `font-feature-settings: "cv01","cv11","ss03"`; weights 400/500/600 only (no 700+). Page title 22px/600/-0.02em; section title 15px/600/-0.01em; body 14px/400/1.5; label 12px/500; micro 11px/500 uppercase tracking 0.06em. Mono: JetBrains Mono 12px for IDs, tokens, timestamps.
Radii: card 12px (`rounded-xl`), control 8px (`rounded-lg`), pill `rounded-full`. No other radii in new code.
Elevation: hairline border + `inset 0 1px 0 rgba(255,255,255,0.03)`; overlays only: `0 12px 40px rgba(0,0,0,0.55)`.
Spacing: 4px base; card padding 20px; grid gap 16px; page gutter 24px (16px under 640px); content max-width 1440px.
Focus ring: `outline: 2px solid #FF8A3D; outline-offset: 2px` on `:focus-visible`.

World tokens: tile 48 world px; ground palette floor `#1A1D23`/`#1E2229` checker, zone floors: conductor `#2A1D14`, engine `#14202B`, fanout `#1E1A2B`, vault `#14251E`; wall `#2C313A` top `#3A404A`; grid line `rgba(255,255,255,0.04)`; sky/void gradient `#0B0C0F -> #15171B`.

## Review Focus
1. jsdom returns `null` from `canvas.getContext("2d")`: renderer must no-op, page must still render panels.
2. Deleting a sandbox agent that is selected or being dragged must clear selection and drag state.
3. Live agents must never expose pause/delete/move controls in the world (read-only).
4. Corrupt or foreign JSON in the sandbox storage key must be ignored (fall back to empty), not crash.
5. Unproject at near-horizon rows must clamp (no Infinity/NaN world coordinates).

---

### Task 1: Design tokens [Tier: Light (Haiku/Flash)]

**Files:**
- Modify: `client/tailwind.config.js` (header stays Son Nguyen; `theme.extend.colors`, add `boxShadow`, `fontFamily` unchanged)
- Modify: `client/src/index.css` (header stays Son Nguyen; `@layer base` scrollbar/selection colors, `@layer components` lines 57-81)
- Do NOT touch: anything else

**Contract:**
- `colors`: add `gray` and `slate` = graphite ramp (both keys, same values); replace `surface`, `border`, `accent` values with the tokens above; add `accent.ink: "#140A03"`; add `pool: { claude: "#FF8A3D", agyclaude: "#A78BFA", gemini: "#5AB8FF" }`.
- `boxShadow`: `hairline: "inset 0 1px 0 rgba(255,255,255,0.03)"`, `overlay: "0 12px 40px rgba(0,0,0,0.55)"`.
- `index.css` base: `body { @apply bg-surface-0 text-gray-200; font-feature-settings: "cv01","cv11","ss03"; }`; scrollbar thumb `#2F343C`, track `#0E0F12`; `::selection` `rgba(255,138,61,0.28)` / `#F5F6F8`; `:focus-visible` ring per tokens.
- Components: `.card` -> `bg-surface-1 border border-border rounded-xl shadow-hairline`; `.card-hover` -> `card transition-colors duration-150 hover:border-border-light hover:bg-surface-2`; `.btn-primary` -> `bg-accent hover:bg-accent-hover text-accent-ink font-medium rounded-lg px-3.5 py-2 text-sm inline-flex items-center gap-2`; `.btn-ghost` -> `text-gray-300 hover:text-gray-100 hover:bg-surface-3 rounded-lg px-3 py-1.5 text-sm inline-flex items-center gap-2`; `.badge` keep shape, `rounded-full` stays; `.input` -> `bg-surface-2 border-border rounded-lg ... focus:border-accent focus:ring-1 focus:ring-accent/30`.
- Add `.page-title` (22px/600/-0.02em, gray-50), `.section-title` (15px/600/-0.01em, gray-100), `.micro-label` (11px/500 uppercase tracking-[0.06em] gray-500).

**Done when:** `cd client && npx tsc -b && npx vitest run src/components` passes.

### Task 2: Shell — extract connection status + new TopNav [Tier: Standard (Sonnet)]

**Files:**
- Create: `client/src/components/shell/connectionStats.ts` (moved logic; header author Son Nguyen because the code is inherited from `Sidebar.tsx:100-230,421-580`)
- Create: `client/src/components/shell/ConnectionStatusModal.tsx` (moved from `Sidebar.tsx:940-1390` incl. `Section`, `KpiTile`, `DetailRow`, `TypeBar`, `Sparkline`, `bucketEventsPerSecond`, `formatRelative`; author Son Nguyen)
- Create: `client/src/components/shell/TopNav.tsx` (new, Nexus author)
- Create: `client/src/components/shell/__tests__/TopNav.test.tsx` (new, ports the 12 cases of `client/src/components/__tests__/Sidebar.test.tsx`)
- Modify: `client/src/components/Layout.tsx` (keep Son Nguyen header, update overview text)
- Delete: `client/src/components/Sidebar.tsx`, `client/src/components/__tests__/Sidebar.test.tsx`

**Context (already discovered):**
- Layout today: `Layout.tsx:96-160` renders `<Sidebar wsConnected collapsed onToggle>` and offsets `<main>` by 15rem/4.25rem. Palette action `layout.toggleSidebar` (`client/src/lib/paletteCommands.ts:374`) is registered in `LayoutActions`.
- Sidebar constants to keep: `NAV_KEYS` (`Sidebar.tsx:105-115`), `REPO_URL` (118), `STORAGE_KEY "sidebar-collapsed"` (121, exported as `SIDEBAR_STORAGE_KEY`), `STATS_STORAGE_KEY "sidebar-connection-stats"` (126), `SUPPORTED_LANGUAGES ["en","zh","vi","ko","es"]` (130), `loadCollapsed()` (168), `normalizeLanguage()` (230). Update check flow `onCheckUpdates` + `UPDATE_CHECK_EVENT` listener (`Sidebar.tsx:589-625`); `updateAvailable` is hard-coded false (627).
- Brand mark: `NexusMark` (`client/src/components/NexusMark.tsx`, prop `size`). Version string: the Vite global `__APP_VERSION__`, rendered as `` `v${__APP_VERSION__}` `` (`Sidebar.tsx:817`); TopNav shows it inside the connection modal trigger's `title` and as `text-[11px] text-gray-500` next to the brand on `xl` screens.
- Open the palette with `openCommandPalette()` from `client/src/lib/appEvents.ts:102`. Update checks requested by the palette arrive as `UPDATE_CHECK_EVENT` (`appEvents.ts:96`); `useUpdateCheck` owns that listener now.
- Select component: `client/src/components/Select.tsx` (used by the language picker).

**Contract (locked):**
```ts
// connectionStats.ts
export interface ConnectionStatsRefs { eventCountRef; peakPerSecRef; lastEventRef; eventTimestampsRef; typeCountRef; recentEventsRef } // same types as ConnectionStatusModalProps today
export function useConnectionStats(wsConnected: boolean): ConnectionStatsRefs & { connectedSince: number | null; resetStats(): void };
export function useUpdateCheck(): { status: UpdateStatusPayload | null; checking: boolean; checkError: boolean; check(): Promise<void> };
// TopNav.tsx
export const NAV_COMPACT_STORAGE_KEY = "sidebar-collapsed"; // reuse existing key so the saved preference survives
export function loadNavCompact(): boolean;
export interface TopNavProps { wsConnected: boolean; compact: boolean; onToggleCompact(): void }
export function TopNav(props: TopNavProps): JSX.Element;
```
- Layout: sticky top bar, height 56px, `bg-surface-0/85 backdrop-blur border-b border-border`, full width. Left: `NexusMark size=28` + brand text (`nav:brand`, 14px/600) linking to `/`. Center (flex-1, `overflow-x-auto no-scrollbar`): primary tabs in order `/`, `/world`, `/rooms`, `/sessions`, `/activity`, `/cascade-graph`, `/quota-roi`, `/cc-config`, `/settings` with lucide icons (reuse Sidebar icons; `/world` uses `Gamepad2`). Tab: `h-8 px-3 rounded-lg text-[13px] font-medium`, inactive `text-gray-400 hover:text-gray-100 hover:bg-surface-3`, active `text-gray-50 bg-surface-3` plus 2px accent underline bar at the tab bottom (`absolute -bottom-[13px] h-0.5 bg-accent`). `compact` hides tab labels (icon only, `title` = label).
- Right cluster: command button (opens palette by dispatching the same event `CommandPalette` listens to; label `nav:search` + `kbd` "Ctrl K"), live pill (`nav:live`/`nav:disconnected`, green/red 6px dot) that opens `ConnectionStatusModal`, language `Select` (icon trigger), GitHub icon link (`REPO_URL`, `aria-label` `nav:github`), and the single primary button `.btn-primary` "Run agent" (`nav:run`) linking to `/run`.
- `<main>`: no left margin; content wrapper `mx-auto max-w-[1440px] px-4 sm:px-6 pt-5 pb-28 overflow-x-clip`. Keep `DualQuotaHeader`, `CommandCenterDock`, `UpdateNotifier`, `CommandPalette`, `ActionToast`, `Tabby`, skip link.
- `layout.toggleSidebar` palette action now toggles `compact`.

**Done when:** `cd client && npx vitest run src/components/shell && npx tsc -b` passes.

### Task 3: World engine (pure) [Tier: Standard (Sonnet)]

**Files:**
- Create: `client/src/utils/world/projection.ts`, `client/src/utils/world/worldMap.ts`, `client/src/utils/world/sandbox.ts`, `client/src/utils/world/entities.ts`
- Create: `client/src/utils/world/__tests__/world.test.ts`

**Contract (locked):**
```ts
// projection.ts — ground-plane perspective camera, world units = tiles
export interface Camera { x: number; y: number; zoom: number } // x,y = tile the camera looks at; zoom 0.6..1.8
export interface Viewport { width: number; height: number }
export const TILE = 48, FOCAL = 320, CAM_HEIGHT = 13.5 /* tiles */, CAM_BACK = 17.5 /* tiles south of look-at */, NEAR = 1.2 /* tiles */;
// Map y grows southward (row 0 = north = far, top of screen); the camera sits south of the look-at point looking north.
// Default camera { x: MAP_W / 2, y: MAP_H / 2, zoom: 1 }: the full map spans ~41%-97% of the canvas height.
export function project(wx: number, wy: number, cam: Camera, vp: Viewport): { sx: number; sy: number; scale: number } | null; // null when behind NEAR plane
export function unproject(sx: number, sy: number, cam: Camera, vp: Viewport): { wx: number; wy: number } | null; // null above horizon; clamp depth to [NEAR, 60]
// worldMap.ts
export const MAP_W = 30, MAP_H = 20;
export type TileKind = "floor" | "wall" | "conductor" | "engine" | "fanout" | "vault" | "path";
export interface ZoneArea { id: RoomZoneId; x: number; y: number; w: number; h: number; desks: Array<{ x: number; y: number }> }
export const ZONE_AREAS: readonly ZoneArea[]; // conductor x1 y1 w12 h7 (8 desks), engine x16 y1 w13 h7 (8 desks), fanout x1 y11 w12 h8 (10 desks), vault x16 y11 w13 h8 (12 desks)
export function tileAt(x: number, y: number): TileKind; // border ring = wall, zone rects = zone kind, row 9 and col 14 = path, else floor
export interface Prop { kind: "desk" | "server" | "plant" | "terminal" | "vault-crate"; x: number; y: number }
export const PROPS: readonly Prop[]; // one desk per desk slot, plus 2 servers per engine, plants at zone corners, crates in vault
// entities.ts
export type WorldSource = "live" | "sandbox";
export type WorldActivity = "idle" | "walking" | "working" | "thinking" | "waiting" | "paused" | "done" | "error";
export interface WorldEntity { id: string; source: WorldSource; name: string; variant: SpriteVariant; zone: RoomZoneId; x: number; y: number; tx: number; ty: number; activity: WorldActivity; task: string | null; facing: "left" | "right" }
export function liveEntitiesFrom(agents: Agent[], sessionsById: Map<string, Session>, prev: Map<string, WorldEntity>): WorldEntity[]; // zone via buildRoomLayout, desk = stable hash(id) slot inside zone, activity from resolveAvatarState
export function stepEntity(e: WorldEntity, dtSec: number, reducedMotion: boolean): WorldEntity; // move toward tx,ty at 2.4 tiles/s; snap when reducedMotion or dist < 0.02; paused/done never move
// sandbox.ts
export const SANDBOX_STORAGE_KEY = "nexus-world-sandbox-v1";
export interface SandboxAgent { id: string; name: string; variant: SpriteVariant; zone: RoomZoneId; task: string; paused: boolean; x: number; y: number; createdAt: number }
export type SandboxAction =
  | { type: "create"; agent: Omit<SandboxAgent, "id" | "createdAt" | "paused" | "x" | "y"> ; id: string; now: number }
  | { type: "pause" | "resume" | "delete"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "clear" };
export function sandboxReducer(state: SandboxAgent[], action: SandboxAction): SandboxAgent[]; // create spawns at the zone's door tile (zone.x + floor(w/2), zone.y + h - 1); move clamps to 1..MAP_W-2 / 1..MAP_H-2 and refuses wall tiles; max 24 agents (create beyond is a no-op)
export function loadSandbox(): SandboxAgent[]; // try/catch, validates shape, drops invalid rows
export function saveSandbox(agents: SandboxAgent[]): void; // try/catch
```
- Imports to reuse: `buildRoomLayout`, `RoomZoneId` from `client/src/utils/agentRooms.ts:17,112`; `resolveAvatarState`, `resolveSpriteVariant`, `SpriteVariant` from `client/src/utils/pixelSprites.ts:19,392,439`; `getAgentThermalTheme` from `client/src/utils/agentTheme.ts:437` (returns provider + tier used by `PixelAvatar.tsx`); types `Agent`, `Session` from `client/src/lib/types.ts`.

**Hard logic:**
```ts
// project: camera sits CAM_BACK tiles south of the look-at point, CAM_HEIGHT tiles up.
const dz = cam.y - wy + CAM_BACK; if (dz < NEAR) return null;
const f = FOCAL * cam.zoom;
const scale = f / (dz * TILE);                    // screen px per world px at that depth
const sx = vp.width / 2 + (wx - cam.x) * TILE * scale;
const sy = vp.height * 0.18 + CAM_HEIGHT * TILE * scale; // horizon at 18% of height
// unproject: h = vp.height*0.18; if (sy <= h + 0.5) return null;
// sy - h = CAM_HEIGHT * TILE * f / (dz * TILE) = CAM_HEIGHT * f / dz  =>  dz = CAM_HEIGHT * f / (sy - h)
// dz = clamp(dz, NEAR, 60); scale = f / (dz * TILE);
// wy = cam.y + CAM_BACK - dz;  wx = cam.x + (sx - vp.width / 2) / (TILE * scale)
```
- Desk slot for live agents: `slot = fnv1a(agent.id) % zone.desks.length`, linear probe to the next free slot; overflow agents stand on the zone floor at `(zone.x + 1 + (i % (w-2)), zone.y + h - 2)`.
- Activity mapping: `working -> working`, `thinking -> thinking`, `waiting_approval -> waiting`, `completed -> done`, `error -> error`, `idle -> idle`. Sandbox: `paused -> paused`, else alternate `working` 6s / `walking` to a random free tile in its zone / `thinking` 3s (seeded by id so tests are deterministic via injected `rand`).

**Done when:** `cd client && npx vitest run src/utils/world` passes, with tests for: project/unproject round trip within 0.01 tile across 20 points; unproject above horizon returns null; reducer create/pause/resume/delete/move/clear, 24-cap, wall refusal; `loadSandbox` with `"{not json"` and `[{"id":1}]` returns `[]`; `stepEntity` paused does not move; reducedMotion snaps.

### Task 4: World renderer + page [Tier: Standard (Sonnet)]

**Files:**
- Create: `client/src/components/world/WorldCanvas.tsx`, `client/src/components/world/drawWorld.ts`, `client/src/components/world/WorldSidePanel.tsx`, `client/src/components/world/CreateAgentDialog.tsx`
- Create: `client/src/pages/AgentWorld.tsx`, `client/src/pages/__tests__/AgentWorld.test.tsx`
- Modify: `client/src/App.tsx:82-91` (import) and `:137` (add `<Route path="world" element={<AgentWorld />} />` before `rooms`)

**Contract:**
```ts
export function drawWorld(ctx: CanvasRenderingContext2D, vp: Viewport, cam: Camera, entities: WorldEntity[], selectedId: string | null, timeSec: number): void;
export interface WorldCanvasProps { entities: WorldEntity[]; selectedId: string | null; onSelect(id: string | null): void; onMoveSandbox(id: string, x: number, y: number): void; reducedMotion: boolean }
```
- Draw order: void gradient; ground tiles row by row from far (y=0) to near as projected quads (`moveTo/lineTo` of 4 projected corners, fill tile color, 1px grid line); props and entities merged and sorted by `y` ascending, drawn as upright billboards: sprite pixel size `= scale * 2.7` CSS px per sprite pixel (a 16px sprite is ~0.9 tile tall), anchored at feet; `imageSmoothingEnabled = false`; ground shadow ellipse under each entity. Sprites come from `buildSpriteRects(variant)` + `SPRITE_DEFINITIONS[variant].palette` (`pixelSprites.ts:234,362`); props are small inline 16x16 role maps defined in `drawWorld.ts` using the world tokens.
- Activity visuals: working = 2-frame bob (1px, 0.5s) + typing sparks over desk; thinking = three dots bubble; waiting = amber "?" bubble drawn as pixels; paused = sprite drawn at 40% alpha + "II" pixel badge; done = green check badge; error = red "!" badge; selected = 2px accent diamond ring on the ground. Live entities get a small pool-colored ground marker; sandbox entities get a dashed ground ring.
- Interaction: pointerdown on a sandbox entity starts drag (pointer capture), pointermove unprojects to world and calls `onMoveSandbox` on pointerup; pointerdown on empty ground pans the camera; wheel zooms (clamp 0.6..1.8); keys W/A/S/D and arrows pan 0.5 tile; `0` recenters. Hit test: entity billboard rect, nearest-first.
- DPR: canvas backing size = CSS size * `devicePixelRatio`; `ResizeObserver` on the container. If `getContext` returns null, render nothing and keep the DOM.
- Page layout: `page-title` "Agent World" + subtitle; toolbar (Create agent `.btn-primary`, Pause all sandbox, Resume all, Clear sandbox with `ConfirmModal`, Recenter, legend toggle); main grid `lg:grid-cols-[1fr_340px]` with the canvas card (height `min(70vh, 720px)`) and `WorldSidePanel`.
- `WorldSidePanel`: tabs "Live" / "Sandbox" listing entities as buttons (sprite via `PixelAvatar` `variant` + `size={24}`, name, zone, activity). Selected entity details: live -> zone, model badge, task, "Open inspector" (opens `AgentInspectorDrawer` from `client/src/components/AgentInspectorDrawer.tsx:46-58`) and no other actions; sandbox -> Pause/Resume, Move to zone (Select of 4 zones; sets position to that zone's door tile), Rename (inline input), Delete (no confirm, undo toast via `ActionToast` is NOT required; delete is immediate).
- `CreateAgentDialog`: fields name (default "Agent <n>"), sprite variant (8 options with previews), zone (4), task text; Create / Cancel; Escape closes; focus trapped.
- Data: copy the loading + WS refresh pattern from `client/src/pages/AgentRooms.tsx:161-245` (agents via `FETCH_STATUSES`, sessions, debounced reload on `agent_*`/`session_*`/remote refresh). No trace store needed.
- Sandbox state: `useReducer(sandboxReducer, undefined, loadSandbox)`; `saveSandbox` in an effect.

**Done when:** `cd client && npx vitest run src/pages/__tests__/AgentWorld.test.tsx` passes, covering: renders title and both panel tabs with mocked `api` (empty lists) and `getContext` returning null; creating a sandbox agent via the dialog lists it; pause shows Resume; delete removes it and clears selection; a live agent row shows "Open inspector" and no Pause/Delete buttons.

### Task 5: i18n keys [Delegate: Antigravity CLI]

**Files:**
- Create: `client/src/i18n/locales/{en,es,ko,vi,zh}/world.json`
- Modify: `client/src/i18n/locales/{en,es,ko,vi,zh}/nav.json` (add `world`, `search`, `runAgent` keys)
- Modify: `client/src/i18n/index.ts` (register `world` namespace the same way the others are registered)

**Contract:** English source keys are the strings Tasks 2 and 4 use (`world:title`, `world:subtitle`, `world:create`, `world:pauseAll`, `world:resumeAll`, `world:clear`, `world:clearConfirm`, `world:recenter`, `world:legend`, `world:live`, `world:sandbox`, `world:openInspector`, `world:pause`, `world:resume`, `world:delete`, `world:rename`, `world:moveTo`, `world:name`, `world:sprite`, `world:zone`, `world:task`, `world:cancel`, `world:readOnly`, `world:empty.live`, `world:empty.sandbox`, `world:activity.<idle|walking|working|thinking|waiting|paused|done|error>`, `world:zones.<conductor|engine|fanout|vault>`, `world:canvasLabel`, `world:controlsHint`). Spanish must be natural Latin American Spanish. No emoji.

**Done when:** `cd client && npx vitest run src/i18n` passes and `bash .claude/skills/i18n-parity/scripts/i18n-audit.sh` exits 0.

### Task 6: Shared primitives polish [Tier: Light (Haiku/Flash)] (parallel group A with Task 5)

**Files:**
- Modify: `client/src/components/StatCard.tsx`, `client/src/components/EmptyState.tsx`, `client/src/components/StatusBadge.tsx`, `client/src/components/DualQuotaHeader.tsx`, `client/src/components/CommandCenterDock.tsx`
- Do NOT touch: pages

**Contract:** Replace hard-coded indigo/violet accents and `rounded-2xl` with tokens (`accent`, `pool-*`, `rounded-xl`), titles to `.section-title`/`.micro-label`, numbers to `font-medium tracking-tight tabular-nums`. Keep every prop, text, and test id. Preserve DOM structure where snapshot tests target text.

**Done when:** `cd client && npx vitest run src/components` passes; then `npx vitest run src/pages/__tests__/screens.snapshot.test.tsx`, inspect the diff, and only if the diff is purely class changes from this task run it with `-u`.

### Task 7: Docs, release, full gate [Tier: Standard (Sonnet)]
- Docs: `README-EN.md` (new "Agent World" section + shell description), mirror into `README-CN.md`, `README-VN.md`, `README-KO.md`, `README-ES.md` (delegate mirroring to Antigravity, then review), `docs/history/` handoff note.
- Apply `version-release` skill for the bump.
- **Done when:** `npm run verify` passes at repo root and `/world` is smoke-tested in Chrome (create, pause, resume, drag, delete a sandbox agent; live agents visible).
