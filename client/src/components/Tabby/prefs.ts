/**
 * @file prefs.ts
 * @description Tiny localStorage-backed preference store for Tabby (enabled +
 *   muted). Broadcasts changes via a window CustomEvent so the Settings toggle
 *   and the live widget stay in sync within the same tab without a reload.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `client/src/components/Tabby/prefs.ts`
 * **Purpose:** Tabby is the optional on-screen cat assistant — quips, intents, and lightweight event reactions layered above the dashboard chrome.
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
 * - `TabbyPos` — exported API; see TSDoc on the symbol for behavior.
 * - `tabbyPrefs` — exported API; see TSDoc on the symbol for behavior.
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
 * **TabbyPos**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **tabbyPrefs**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

const ENABLED_KEY = "agent-dashboard-tabby-enabled";
/** localStorage key for the muted preference. */
const MUTED_KEY = "agent-dashboard-tabby-muted";
/** localStorage key for the docked position. */
const POS_KEY = "agent-dashboard-tabby-pos";
/**
 * Window event fired when the enabled or muted preference changes, so Settings and the live widget
 * stay in sync in the same tab.
 */
const EVENT = "tabby:prefs";

/**
 * Persisted resting position, AssistiveTouch-style: the widget always docks to
 * the left or right edge, remembering its vertical offset. `y` is stored as a
 * fraction of the viewport height (0–1) so it survives window resizes.
 */
export interface TabbyPos {
  /** Edge the avatar is docked to. */
  side: "left" | "right";
  /**
   * Vertical position as a fraction (0 at the top, 1 at the bottom) of the space the avatar can
   * move in, so it survives window resizes.
   */
  y: number;
}

/**
 * Read a boolean preference.
 *
 * @param key - localStorage key.
 * @param fallback - Value when unset or storage is unavailable.
 * @returns The stored value or the fallback.
 */
function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

/**
 * Write a boolean preference and notify listeners in this tab. Storage failures (private mode,
 * quota) are ignored, since preferences are best-effort.
 *
 * @param key - localStorage key.
 * @param value - New value.
 */
function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures (private mode, quota) - prefs are best-effort.
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // SSR / non-DOM contexts: nothing to notify.
  }
}

/**
 * Read the stored docked position, validating its shape and clamping `y` to 0 to 1.
 *
 * @returns The position, or null when unset or invalid.
 */
function readPos(): TabbyPos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TabbyPos>;
    if ((p.side === "left" || p.side === "right") && typeof p.y === "number") {
      return { side: p.side, y: Math.min(1, Math.max(0, p.y)) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store the docked position. Deliberately does not fire the preferences event, because position
 * changes are local to the widget.
 *
 * @param pos - New position.
 */
function writePos(pos: TabbyPos): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // Ignore storage failures - position is best-effort.
  }
  // Note: intentionally does NOT dispatch the prefs event - position changes
  // are local to the widget and shouldn't churn the Settings toggle listeners.
}

/**
 * Tabby's persisted preferences: enabled (default on), muted (default off), and docked position,
 * plus a subscription to enabled and muted changes.
 */
export const tabbyPrefs = {
  getEnabled: () => readBool(ENABLED_KEY, false),
  setEnabled: (v: boolean) => writeBool(ENABLED_KEY, v),
  getMuted: () => readBool(MUTED_KEY, false),
  setMuted: (v: boolean) => writeBool(MUTED_KEY, v),
  getPos: readPos,
  setPos: writePos,
  /** Subscribe to any pref change; returns an unsubscribe fn. */
  subscribe(handler: () => void): () => void {
    const listener = () => handler();
    window.addEventListener(EVENT, listener);
    // Also react to changes from other tabs.
    window.addEventListener("storage", listener);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.removeEventListener("storage", listener);
    };
  },
};
