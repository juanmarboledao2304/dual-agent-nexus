/**
 * @file Process-wide runtime state and the error model for the ccam CLI.
 *
 * `state` carries the resolved global options (--json / --format, --server,
 * --token) that the root command's preAction hook copies in before any
 * action runs, so deep helpers (the HTTP client, renderers, confirmations)
 * can honor them without threading options through every call.
 *
 * Errors are values, not exits: commands throw CliError (usage/validation),
 * ApiError (HTTP failure), or ServerDownError (no server answered), and the
 * single top-level reporter prints them — human-styled on stderr, or as a
 * `{"error":{...}}` JSON document in JSON mode so agents can parse failures
 * as reliably as successes. Exit codes are stable and backward compatible:
 * 0 success, 1 any failure; the failure *kind* is carried by the JSON
 * `error.code` (USAGE, SERVER_DOWN, CONFIRMATION_REQUIRED, HTTP_404, …).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { c, jsonRequested } = require("./ui");

// Resolve the repo root relative to the REAL location of the CLI so it works
// both from a checkout and through the global symlink `npm link` creates.
const REPO_ROOT = path.resolve(path.dirname(fs.realpathSync(__filename)), "..", "..");
const ENTRY = path.join(REPO_ROOT, "bin", "ccam.js");

const EXIT = { OK: 0, FAILURE: 1 };

const state = {
  output: jsonRequested
    ? "json"
    : /^pretty$/i.test(String(process.env.CCAM_OUTPUT || ""))
      ? "pretty"
      : "auto",
  url: null,
  token: null,
};

/** True when output should be machine-readable JSON. */
const isJson = () => state.output === "json";
/** True when the user explicitly asked for the human view of a JSON-default command. */
const isPretty = () => state.output === "pretty";

/** Usage / validation / refusal errors. `hints` render as dim follow-up lines. */
class CliError extends Error {
  constructor(message, { hints = [], exitCode = EXIT.FAILURE, code = "CLI_ERROR" } = {}) {
    super(message);
    this.hints = hints;
    this.exitCode = exitCode;
    this.code = code;
  }
}

/** A non-2xx API response. */
class ApiError extends CliError {
  constructor(method, pathname, status, body) {
    const msg = body?.error?.message || `HTTP ${status}`;
    super(`${method} ${pathname} → ${msg}`, { code: body?.error?.code || `HTTP_${status}` });
    this.status = status;
    this.body = body;
  }
}

/** Thrown when the dashboard server does not answer — the command wrapper
 *  decides whether the active command has an offline fallback or must abort. */
class ServerDownError extends Error {}

/** Print an error in the active output mode and set the exit code. */
function reportError(err) {
  const exitCode = err.exitCode ?? EXIT.FAILURE;
  if (isJson()) {
    const payload = { error: { code: err.code || "ERROR", message: err.message } };
    if (err.hints?.length) payload.error.hints = err.hints;
    if (err.status) payload.error.status = err.status;
    if (err.extra) Object.assign(payload.error, err.extra);
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } else {
    console.error(c.red(`ERR ${err.message}`));
    for (const h of err.hints || []) console.error(c.dim(`  ${h}`));
  }
  process.exitCode = exitCode;
}

/** Read the package version (single source of truth: package.json). */
function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

module.exports = {
  REPO_ROOT,
  ENTRY,
  EXIT,
  state,
  isJson,
  isPretty,
  CliError,
  ApiError,
  ServerDownError,
  reportError,
  pkgVersion,
};
