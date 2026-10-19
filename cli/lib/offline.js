/**
 * @file Offline mode for the ccam CLI. When the dashboard server is down,
 * read-only commands fall back to reading the SQLite database directly (a
 * second reader is safe under WAL). Commands that need server-side logic
 * (cost math, analytics aggregation, live capture, mutations with broadcasts)
 * refuse instead via serverDown() — running them against the raw DB would
 * produce unreliable or divergent results.
 *
 * Also owns the display-side liveness correction: while the server is down
 * its dead-session reap is not running, so sessions quit after it stopped
 * still read active/waiting. The same process-liveness probe the server's
 * watchdog uses corrects the DISPLAYED status; the database is never written.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { c } = require("./ui");
const { REPO_ROOT, isJson, CliError } = require("./runtime");
const { baseUrl } = require("./http");

/** DB path resolution mirrors server/db.js: env override, then data/. */
function dbPath() {
  return process.env.DASHBOARD_DB_PATH || path.join(REPO_ROOT, "data", "dashboard.db");
}

/**
 * Open the dashboard database for reading. Tries better-sqlite3 from the
 * repo's node_modules first, then Node's built-in node:sqlite (Node 22+).
 * Never creates a database file (existence is checked first), and the CLI
 * only ever issues SELECTs through the returned handle. The connection is
 * deliberately NOT opened with SQLite's readonly flag: a strict readonly
 * connection cannot attach a live WAL's shared-memory index and would
 * silently read the pre-WAL (stale/empty) state when another process has the
 * database open — a normal connection under WAL reads consistently instead.
 */
function openDbReadonly() {
  const file = dbPath();
  if (!fs.existsSync(file)) return null;
  try {
    const Database = require(path.join(REPO_ROOT, "node_modules", "better-sqlite3"));
    const db = new Database(file, { fileMustExist: true });
    return { all: (sql, ...p) => db.prepare(sql).all(...p) };
  } catch {
    /* fall through to node:sqlite */
  }
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file);
    return { all: (sql, ...p) => db.prepare(sql).all(...p) };
  } catch {
    return null;
  }
}

/** Open the DB read-only or fail with guidance. */
function requireDb() {
  const db = openDbReadonly();
  if (!db) {
    throw new CliError(`No readable database at ${dbPath()}`, {
      code: "NO_DATABASE",
      hints: [
        "Nothing has been captured yet, or no SQLite driver is available.",
        "Start the server to begin capturing: ccam start",
      ],
    });
  }
  return db;
}

/** One-time banner explaining that results come straight from the DB file.
 *  In JSON mode it goes to stderr so stdout stays a parseable document. */
function offlineBanner() {
  if (isJson()) {
    process.stderr.write(
      `${JSON.stringify({ warning: { code: "OFFLINE", message: "server not running; read from database", db: dbPath() } })}\n`
    );
    return;
  }
  console.log(
    `${c.yellow("WARN Offline mode")} ${c.dim(`— server not running; reading ${dbPath()} directly.`)}`
  );
  console.log(
    c.dim("  Data is as of the last capture — live capture and full features need the server: ") +
      c.bold("ccam start")
  );
  console.log();
}

/**
 * Print the standard "server is not running" indicator and set exit 1. Every
 * command that needs the API funnels through this, so the guidance is
 * identical everywhere.
 */
function serverDown(reason) {
  process.exitCode = 1;
  if (isJson()) {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: "SERVER_DOWN",
          message: "Dashboard server is NOT running",
          url: baseUrl(),
          ...(reason ? { reason: `No offline fallback for this command: ${reason}` } : {}),
          hints: ["ccam start", "npm run dev", "npm start"],
        },
      })}\n`
    );
    return;
  }
  console.error(`${c.red("○ Dashboard server is NOT running")} ${c.dim(`(tried ${baseUrl()})`)}`);
  if (reason) console.error(c.dim(`  No offline fallback for this command: ${reason}.`));
  console.error(c.dim("  This command needs the server. Start it with one of:"));
  console.error(
    `    ${c.bold("ccam start")}        ${c.dim("# production server in the background")}`
  );
  console.error(
    `    ${c.bold("npm run dev")}       ${c.dim("# dev mode (hot reload), foreground")}`
  );
  console.error(`    ${c.bold("npm start")}         ${c.dim("# production mode, foreground")}`);
}

/**
 * Correct the DISPLAYED status of active sessions whose cwd has no running
 * `claude` process. Returns the number of corrected sessions, the set of
 * their ids (so agent rows can be corrected consistently), and whether the
 * probe could answer at all (it can't on Windows or inside containers).
 */
function livenessCorrect(sessions) {
  let probe;
  try {
    probe = require(path.join(REPO_ROOT, "server", "lib", "session-liveness.js")).probeLiveCwds();
  } catch {
    probe = { available: false };
  }
  const hadActive = sessions.some((s) => s.status === "active");
  if (!probe.available) return { available: false, hadActive, corrected: 0, deadIds: new Set() };
  const deadIds = new Set();
  for (const s of sessions) {
    if (s.status !== "active" || !s.cwd) continue;
    let resolved;
    try {
      resolved = path.resolve(s.cwd);
    } catch {
      continue;
    }
    if (!probe.cwds.has(resolved)) {
      s.status = "completed";
      s.awaiting_input_since = null;
      deadIds.add(s.id);
    }
  }
  return { available: true, corrected: deadIds.size, deadIds };
}

/** Correct agent rows belonging to sessions the probe found dead. */
function livenessCorrectAgents(agents, deadIds) {
  let n = 0;
  for (const a of agents) {
    if (deadIds.has(a.session_id) && a.status !== "completed" && a.status !== "error") {
      a.status = "completed";
      a.awaiting_input_since = null;
      n++;
    }
  }
  return n;
}

/** Footnote for corrected output / caveat when the probe cannot answer. */
function livenessNote(result) {
  if (isJson()) return;
  if (!result.available) {
    if (!result.hadActive) return; // nothing that could be stale was shown
    console.log(
      c.dim(
        "※ Statuses are as stored: sessions that ended while the server was down may still show active/waiting (liveness probe unavailable on this platform)."
      )
    );
  } else if (result.corrected > 0) {
    console.log(
      c.dim(
        `※ ${result.corrected} session(s) displayed as completed by the process-liveness probe — no running claude process owns them. The database is only updated once the server runs again.`
      )
    );
  }
}

/** Offline data providers shaped exactly like their API counterparts. */
const offlineData = {
  sessions(db, opts) {
    const conds = [];
    const params = [];
    if (opts.status) {
      conds.push("s.status = ?");
      params.push(opts.status);
    }
    if (opts.q) {
      conds.push("(s.id LIKE ? OR s.name LIKE ? OR s.cwd LIKE ?)");
      const like = `%${opts.q}%`;
      params.push(like, like, like);
    }
    if (opts.cwd) {
      conds.push("s.cwd = ?");
      params.push(opts.cwd);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limit = Number(opts.limit || 20);
    const offset = Number(opts.offset || 0);
    const rows = db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM agents a WHERE a.session_id = s.id) AS agent_count
       FROM sessions s ${where} ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );
    const total = db.all(`SELECT COUNT(*) AS n FROM sessions s ${where}`, ...params)[0].n;
    return { sessions: rows, total, limit, offset };
  },
  agents(db, opts) {
    const conds = [];
    const params = [];
    if (opts.status) {
      conds.push("status = ?");
      params.push(opts.status);
    }
    if (opts.session) {
      conds.push("session_id = ?");
      params.push(opts.session);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return {
      agents: db.all(
        `SELECT * FROM agents ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
        ...params,
        Number(opts.limit || 20),
        Number(opts.offset || 0)
      ),
    };
  },
  events(db, opts) {
    const conds = [];
    const params = [];
    if (opts.session) {
      conds.push("session_id = ?");
      params.push(opts.session);
    }
    if (opts.type?.length) {
      conds.push(`event_type IN (${opts.type.map(() => "?").join(",")})`);
      params.push(...opts.type);
    }
    if (opts.tool?.length) {
      conds.push(`tool_name IN (${opts.tool.map(() => "?").join(",")})`);
      params.push(...opts.tool);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return {
      events: db.all(
        `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...params,
        Number(opts.limit || 20),
        Number(opts.offset || 0)
      ),
    };
  },
  stats(db) {
    const one = (sql, ...p) => db.all(sql, ...p)[0].n;
    const dist = {};
    for (const r of db.all("SELECT status, COUNT(*) AS n FROM sessions GROUP BY status")) {
      dist[r.status] = r.n;
    }
    const agentDist = {};
    for (const r of db.all("SELECT status, COUNT(*) AS n FROM agents GROUP BY status")) {
      agentDist[r.status] = r.n;
    }
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return {
      total_sessions: one("SELECT COUNT(*) AS n FROM sessions"),
      active_sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'"),
      total_agents: one("SELECT COUNT(*) AS n FROM agents"),
      active_agents: one("SELECT COUNT(*) AS n FROM agents WHERE status = 'working'"),
      total_events: one("SELECT COUNT(*) AS n FROM events"),
      events_today: one(
        "SELECT COUNT(*) AS n FROM events WHERE created_at >= ?",
        midnight.toISOString()
      ),
      ws_connections: 0,
      sessions_by_status: dist,
      agents_by_status: agentDist,
    };
  },
};

module.exports = {
  dbPath,
  openDbReadonly,
  requireDb,
  offlineBanner,
  serverDown,
  livenessCorrect,
  livenessCorrectAgents,
  livenessNote,
  offlineData,
};
