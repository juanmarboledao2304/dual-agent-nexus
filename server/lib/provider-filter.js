/**
 * @file provider-filter.js
 * @description Shared SQL filters for the dashboard-wide Claude/Cursor/Codex
 * scope. The Claude product choice intentionally includes Cursor sessions,
 * matching onboarding, while direct `cursor` API scopes remain available.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const VALID_PROVIDERS = new Set(["claude", "cursor", "codex", "antigravity"]);

/** Parse `?providers=claude,codex`; absent means every provider. */
function parseProviders(req) {
  const raw = req.query ? req.query.providers : undefined;
  if (typeof raw !== "string") return null;
  const providers = [
    ...new Set(
      raw
        .split(",")
        .map((v) => v.trim())
        .filter((v) => VALID_PROVIDERS.has(v))
    ),
  ];
  if (providers.length === 0) return null;
  // Cursor uses Claude-compatible lifecycle hooks but has its own transcript
  // store and rate card. Product scope keeps the existing two-choice UX:
  // "Claude Code" means the Claude-compatible family (Claude + Cursor).
  if (providers.includes("claude") && !providers.includes("cursor")) providers.push("cursor");
  return providers;
}

/** SQL predicate for a query that already aliases sessions. */
function providerColumnClause(providers, col = "s.provider") {
  if (!providers || providers.length === 0) return { clause: "", params: [] };
  return { clause: `${col} IN (${providers.map(() => "?").join(",")})`, params: providers };
}

/** SQL predicate for tables that only carry a session id. */
function sessionIdInProvidersClause(providers, sessionIdCol) {
  if (!providers || providers.length === 0) return { clause: "", params: [] };
  return {
    clause: `${sessionIdCol} IN (SELECT id FROM sessions WHERE provider IN (${providers
      .map(() => "?")
      .join(",")}))`,
    params: providers,
  };
}

module.exports = { parseProviders, providerColumnClause, sessionIdInProvidersClause };
