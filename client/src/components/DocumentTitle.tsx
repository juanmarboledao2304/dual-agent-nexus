/**
 * @file DocumentTitle.tsx
 * @description Route-aware document title setter nested under BrowserRouter so
 * `useLocation` works. Keeps multi-tab window switchers readable.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `client/src/components/DocumentTitle.tsx`
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
 * - `../hooks/useDocumentTitle`
 *
 * ## Public surface
 * - `DocumentTitle` — exported API; see TSDoc on the symbol for behavior.
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
 * **DocumentTitle**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/**
 * Maps the current pathname to a localized browser tab title.
 */
export function DocumentTitle() {
  const { t } = useTranslation("nav");
  const location = useLocation();

  let title = t("dashboard");
  const path = location.pathname;
  const sessionId = path.match(/^\/sessions\/([^/]+)/)?.[1];

  if (sessionId) {
    title = `${t("sessions")} · ${sessionId.slice(0, 8)}`;
  } else if (path.startsWith("/sessions")) {
    title = t("sessions");
  } else if (path.startsWith("/world")) {
    title = t("world");
  } else if (path.startsWith("/rooms") || path.startsWith("/kanban")) {
    title = t("agentBoard");
  } else if (path.startsWith("/activity")) {
    title = t("activityFeed");
  } else if (path.startsWith("/quota-roi") || path.startsWith("/analytics")) {
    title = t("analytics");
  } else if (path.startsWith("/cascade-graph") || path.startsWith("/workflows")) {
    title = t("workflows");
  } else if (path.startsWith("/cc-config")) {
    title = t("ccConfig");
  } else if (path.startsWith("/run")) {
    title = t("run");
  } else if (path.startsWith("/settings")) {
    title = t("settings");
  } else if (path !== "/") {
    title = t("notFound");
  }

  useDocumentTitle(title);
  return null;
}
