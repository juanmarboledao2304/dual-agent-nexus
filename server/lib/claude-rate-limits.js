/**
 * @file The real Claude subscription limits. Claude Code hands its statusline command a `rate_limits`
 * object (five_hour / seven_day windows with used_percentage and resets_at, straight from the API);
 * `statusline/nexus-statusline.js` forwards it to POST /api/quota/claude-limits and this module keeps
 * the latest snapshot in memory and on disk (`<data dir>/claude-rate-limits.json`) so it survives a
 * restart. The quota meter prefers these numbers over the token-count estimate.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDataDir } = require("./claude-home");

const WINDOWS = ["five_hour", "seven_day"];

let latest = null;
let loaded = false;

function storePath() {
  return path.join(getDataDir(), "claude-rate-limits.json");
}

/** Validate one window: a 0..100+ percentage and a reset time in epoch seconds. */
function cleanWindow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const used = Number(raw.used_percentage);
  const resets = Number(raw.resets_at);
  if (!Number.isFinite(used) || used < 0 || used > 1000) return null;
  if (!Number.isFinite(resets) || resets <= 0) return null;
  return { used_percentage: Math.round(used * 10) / 10, resets_at: Math.round(resets) };
}

/**
 * Validate a statusline `rate_limits` payload.
 *
 * @param {unknown} body - Request body (`{ rate_limits: {...} }` or the bare object).
 * @returns {{ five_hour?: object, seven_day?: object } | null} null when nothing usable.
 */
function parseRateLimits(body) {
  const src = body && typeof body === "object" && body.rate_limits ? body.rate_limits : body;
  if (!src || typeof src !== "object") return null;
  const out = {};
  for (const key of WINDOWS) {
    const w = cleanWindow(src[key]);
    if (w) out[key] = w;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    const windows = parseRateLimits(raw);
    if (windows && typeof raw.updated_at === "string")
      latest = { ...windows, updated_at: raw.updated_at };
  } catch {
    latest = null;
  }
}

/**
 * Record a snapshot. Windows missing from this payload are dropped (Claude Code omits a window once
 * its resets_at has passed).
 *
 * @returns {object|null} The stored snapshot, or null when the payload was unusable.
 */
function recordRateLimits(body, now = Date.now()) {
  const windows = parseRateLimits(body);
  if (!windows) return null;
  loaded = true;
  latest = { ...windows, updated_at: new Date(now).toISOString() };
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(latest));
  } catch {
    // Memory copy still serves the dashboard; persistence is best-effort.
  }
  return latest;
}

/**
 * Current limits with expired windows removed.
 *
 * @returns {{ five_hour?: object, seven_day?: object, updated_at: string, source: 'statusline' } | null}
 */
function getRateLimits(now = Date.now()) {
  load();
  if (!latest) return null;
  const out = {};
  for (const key of WINDOWS) {
    const w = latest[key];
    if (w && w.resets_at * 1000 > now) out[key] = w;
  }
  if (Object.keys(out).length === 0) return null;
  return { ...out, updated_at: latest.updated_at, source: "statusline" };
}

/** Test seam: forget the cached snapshot. */
function resetRateLimitsCache() {
  latest = null;
  loaded = false;
}

module.exports = { parseRateLimits, recordRateLimits, getRateLimits, resetRateLimitsCache };
