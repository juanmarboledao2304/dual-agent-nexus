/**
 * @file Layout.tsx
 * @description Application shell that frames every authenticated route: the sticky
 * top navigation, a centered max-width content column, update notifier, the
 * Cmd/Ctrl+K command palette, and the Tabby assistant overlay.
 * The layout is the single parent route in {@link App} — child pages render inside
 * React Router's `<Outlet />` so navigation never remounts chrome.
 *
 * ## Navigation persistence
 * Compact (icon-only) navigation is read once from `localStorage` via
 * {@link loadNavCompact} and written back on every toggle. Failures to access storage are swallowed so a
 * private-browsing quota error never breaks the UI.
 *
 * ## Sticky descendants
 * The inner content wrapper uses `overflow-x-clip` (not `hidden`) so horizontal
 * overflow is clipped without creating a scroll container. That keeps `position:
 * sticky` elements — e.g. the Settings page table-of-contents — pinned to the
 * viewport rather than a nested scroll box.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `client/src/components/Layout.tsx`
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
 * ## Internal dependencies
 * - `./shell/TopNav`
 * - `./UpdateNotifier`
 * - `./CommandPalette`
 * - `./Tabby/Tabby`
 *
 * ## Public surface
 * - `Layout` — exported API; see TSDoc on the symbol for behavior.
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
 * **Layout**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useCallback, useState } from "react";
import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { TopNav, NAV_COMPACT_STORAGE_KEY, loadNavCompact } from "./shell/TopNav";
import { UpdateNotifier } from "./UpdateNotifier";
import { CommandPalette } from "./CommandPalette";
import { Tabby } from "./Tabby/Tabby";
import { ActionToast } from "./ActionToast";
import { PaletteActionProvider, usePaletteAction } from "./PaletteActionProvider";
import { DualQuotaHeader } from "./DualQuotaHeader";
import { CommandCenterDock } from "./CommandCenterDock";

/** Props for {@link Layout}. */
interface LayoutProps {
  /** Live WebSocket status forwarded to the navigation's connection pill. */
  wsConnected: boolean;
}

/**
 * Registers the shell-level commands the palette offers on every page: the
 * compact-navigation toggle and the two scroll jumps. They are palette actions rather than
 * chords — ⌘/Ctrl+K is the dashboard's only navigation shortcut.
 */
function LayoutActions({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  usePaletteAction("layout.toggleSidebar", onToggleSidebar);
  usePaletteAction("layout.scrollTop", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  usePaletteAction("layout.scrollBottom", () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });
  return null;
}

/**
 * Root layout wrapping all dashboard routes: top navigation, global overlays, DualQuotaHeader,
 * CommandCenterDock, and the routed page outlet.
 * @param props See {@link LayoutProps}.
 */
export function Layout({ wsConnected }: LayoutProps) {
  const { t } = useTranslation("nav");
  const [compact, setCompact] = useState(loadNavCompact);

  /** Toggle icon-only navigation and remember the choice in localStorage. */
  const toggle = useCallback(() => {
    setCompact((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COMPACT_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <PaletteActionProvider>
      <div className="min-h-screen bg-surface-0 text-gray-200">
        <a href="#main-content" className="skip-to-content">
          {t("skipToContent")}
        </a>
        <LayoutActions onToggleSidebar={toggle} />
        <UpdateNotifier />
        <CommandPalette />
        <ActionToast />
        <Tabby />
        <TopNav wsConnected={wsConnected} compact={compact} />
        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">
          {/* overflow-x-clip (not -hidden) clips horizontal overflow without
            creating a scroll container, so descendant `position: sticky`
            elements (e.g. the Settings page TOC) still pin to the window. */}
          <div className="mx-auto w-full max-w-[1440px] overflow-x-clip px-4 pb-28 pt-5 sm:px-6">
            <DualQuotaHeader />
            <Outlet />
          </div>
        </main>
        <CommandCenterDock />
      </div>
    </PaletteActionProvider>
  );
}
