/**
 * @file appEvents.ts
 * @description Window events used to trigger app-wide chrome from anywhere in the
 * tree, plus the typed helpers that dispatch them.
 *
 * These live in `lib/` rather than beside the components that handle them for one
 * reason: the trigger and the handler are usually in different components, and
 * importing one component from the other creates a cycle (the sidebar opens the
 * palette; the palette asks the sidebar to check for updates). A shared module
 * breaks that without giving either component knowledge of the other.
 *
 * A window event is also the right coupling here regardless: no context provider,
 * no lifted state, and any component — or a test — can trigger the behavior.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `client/src/lib/appEvents.ts`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Public surface
 * - `COMMAND_PALETTE_EVENT` — exported API; see TSDoc on the symbol for behavior.
 * - `UPDATE_CHECK_EVENT` — exported API; see TSDoc on the symbol for behavior.
 * - `ACTION_TOAST_EVENT` — exported API; see TSDoc on the symbol for behavior.
 * - `openCommandPalette` — exported API; see TSDoc on the symbol for behavior.
 * - `requestUpdateCheck` — exported API; see TSDoc on the symbol for behavior.
 * - `announceAction` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **COMMAND_PALETTE_EVENT**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **UPDATE_CHECK_EVENT**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **ACTION_TOAST_EVENT**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **openCommandPalette**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **requestUpdateCheck**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **announceAction**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

/** Opens the command palette. Handled by `CommandPalette`. */
export const COMMAND_PALETTE_EVENT = "ccam:command-palette";

/** Asks the sidebar to run an update check. Handled by `Sidebar`. */
export const UPDATE_CHECK_EVENT = "ccam:check-updates";

/** Carries a short confirmation to the toast. Handled by `ActionToast`. */
export const ACTION_TOAST_EVENT = "ccam:action-toast";

/** Open the command palette from outside the component. */
export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

/**
 * Ask the sidebar to re-check for a release. The check itself stays in the
 * sidebar, which owns the spinner, the failure state, and the modal that reports
 * the result.
 */
export function requestUpdateCheck(): void {
  window.dispatchEvent(new CustomEvent(UPDATE_CHECK_EVENT));
}

/**
 * Confirm an action that changed something without moving the user.
 *
 * A palette command that toggles a preference or copies a link closes the
 * palette and then, visibly, does nothing — which reads as broken even when it
 * worked. Navigation is its own feedback; everything else needs this.
 *
 * @param message - Text to show in the action toast.
 */
export function announceAction(message: string): void {
  window.dispatchEvent(new CustomEvent(ACTION_TOAST_EVENT, { detail: message }));
}

/** Event name that opens the Launch panel (agent dispatcher plus interactive run). */
export const LAUNCH_PANEL_EVENT = "ccam:launch-panel";

/**
 * Open the Launch panel. The top bar's "Run agent" button and the command palette both use it.
 */
export function openLaunchPanel(): void {
  window.dispatchEvent(new CustomEvent(LAUNCH_PANEL_EVENT));
}
