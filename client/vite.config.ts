/**
 * @file vite.config.ts
 * @description Vite build and dev-server configuration for the dashboard client — React plugin, an API/WebSocket proxy that honours DASHBOARD_PORT, and build-time injection of the project version as `__APP_VERSION__`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Resolve the version shown in the UI footer. It is the canonical project version from the
 * repo-root `package.json` (the version CI cuts releases from), injected at build time as the
 * `__APP_VERSION__` global so the footer never shows a hardcoded string. Vite runs from the client
 * directory, so the root manifest is normally one level up. It falls back to the client manifest,
 * then a placeholder, so the build never fails when the root file is absent (for example a Docker
 * stage that only copies `client/`). The global is declared in `client/src/vite-env.d.ts`.
 *
 * @returns The version string.
 */
function resolveAppVersion(): string {
  for (const rel of ["../package.json", "package.json"]) {
    try {
      const { version } = JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf8"));
      if (version) return version as string;
    } catch {
      // Not found or unreadable at this path — try the next candidate.
    }
  }
  return "0.0.0";
}
/** Version injected as `__APP_VERSION__`. */
const APP_VERSION = resolveAppVersion();

/**
 * Port of the dashboard server the dev proxy forwards to. Honors `DASHBOARD_PORT`, so the proxy
 * follows when `npm run dev:server` is moved off the default 7770 (for example when an SSH
 * `LocalForward` already holds 7770 on `127.0.0.1` and `::1`). The dev server reads the same
 * variable from `server/index.js`, so a single `DASHBOARD_PORT=7771 npm run dev` keeps both sides
 * in step.
 *
 * The proxy targets `127.0.0.1` rather than `localhost`: when several listeners share a port across
 * IP families (loopback-specific SSH binds and Node's wildcard listen), macOS routes connections by
 * socket specificity, so `localhost` can reach the wrong process. An explicit IPv4 loopback is also
 * what the embedded production server binds to.
 */
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "7770", 10);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${DASHBOARD_PORT}`,
        changeOrigin: true,
      },
      "/ws": {
        target: `ws://127.0.0.1:${DASHBOARD_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
