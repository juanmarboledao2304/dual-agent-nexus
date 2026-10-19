/**
 * @file ccam server lifecycle commands: status, health, start, stop, restart,
 * logs, and open. `start` launches a detached production server (log in
 * data/ccam-server.log) and waits for /api/health; `stop` resolves the exact
 * server this CLI talks to via the discovery file and sends SIGTERM,
 * escalating to SIGKILL after 5 s; `logs` tails that log file; `open` opens
 * the dashboard (optionally a specific page or session) in the browser.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { Argument } = require("commander");
const { c, printJson, kvCard, heading } = require("../lib/ui");
const { REPO_ROOT, isJson, CliError, pkgVersion } = require("../lib/runtime");
const { baseUrl, get, serverIsUp, enc } = require("../lib/http");
const { run, posIntArg, intArg } = require("../lib/framework");

const GROUP = "Server:";
const LOG_FILE = path.join(REPO_ROOT, "data", "ccam-server.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdStatus() {
  const up = await serverIsUp();
  if (isJson()) {
    const h = up ? await get("/api/health") : null;
    printJson({ running: up, url: baseUrl(), health: h });
    if (!up) process.exitCode = 1;
    return;
  }
  if (up) {
    const h = await get("/api/health");
    console.log(
      `${c.green("●")} Dashboard server is ${c.bold("running")} at ${baseUrl()} (${h.timestamp})`
    );
  } else {
    console.log(
      `${c.red("○")} Dashboard server is ${c.bold("NOT running")} ${c.dim(`(tried ${baseUrl()})`)}`
    );
    console.log(c.dim("  Start it with: ccam start   (or npm run dev / npm start)"));
    process.exitCode = 1;
  }
}

async function cmdHealth() {
  const h = await get("/api/health");
  if (isJson()) return printJson({ ...h, url: baseUrl() });
  const ver = h.version ? ` v${h.version}` : "";
  console.log(`${c.green("●")} Dashboard ${c.bold("up")}${ver} at ${baseUrl()} (${h.timestamp})`);
}

/**
 * Start the dashboard server in the background (production mode, serving the
 * built client) and wait until /api/health answers. No-ops with a pointer to
 * the live URL when a server is already up. The child is fully detached with
 * its output appended to data/ccam-server.log, so closing this terminal does
 * not stop the dashboard.
 */
async function startServer(opts) {
  if (await serverIsUp()) {
    if (isJson()) return printJson({ started: false, already_running: true, url: baseUrl() });
    console.log(`${c.green("●")} Dashboard already running at ${c.bold(baseUrl())}`);
    return;
  }
  const clientDist = path.join(REPO_ROOT, "client", "dist", "index.html");
  if (!fs.existsSync(clientDist)) {
    throw new CliError("client/dist is missing — the production server needs a built client.", {
      code: "CLIENT_NOT_BUILT",
      hints: [
        "Build it once with: npm run build   (then re-run: ccam start)",
        "Or run the dev servers instead:     npm run dev",
      ],
    });
  }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const out = fs.openSync(LOG_FILE, "a");
  const env = { ...process.env, NODE_ENV: "production" };
  if (opts.port) {
    env.DASHBOARD_PORT = String(opts.port);
    // The health probe below must target the port we just asked for.
    process.env.DASHBOARD_PORT = String(opts.port);
  }
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server", "index.js")], {
    detached: true,
    stdio: ["ignore", out, out],
    env,
    cwd: REPO_ROOT,
  });
  child.unref();
  // On a TTY, animate a braille spinner in place; when piped, fall back to a
  // dot-per-poll trail so progress still shows without cursor control.
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const live = Boolean(process.stdout.isTTY) && !isJson();
  const quiet = isJson();
  let tick = 0;
  const announce = `Starting dashboard server (pid ${child.pid}, log ${LOG_FILE})`;
  if (!quiet) {
    if (live) process.stdout.write(`${c.cyan(spinner[0])} ${c.dim(announce)}`);
    else process.stdout.write(c.dim(`${announce} `));
  }
  const clearLine = () => {
    if (quiet) return;
    if (live) process.stdout.write("\r\x1b[K");
    else process.stdout.write("\n");
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await serverIsUp()) {
      clearLine();
      if (isJson())
        return printJson({ started: true, pid: child.pid, url: baseUrl(), log: LOG_FILE });
      console.log(
        `${c.green("●")} Dashboard ${c.bold("up")} at ${c.bold(baseUrl())} ${c.dim(`(pid ${child.pid})`)}`
      );
      console.log(c.dim(`  Stop it with: ccam stop   (or kill ${child.pid})`));
      return;
    }
    tick++;
    if (!quiet) {
      if (live)
        process.stdout.write(`\r${c.cyan(spinner[tick % spinner.length])} ${c.dim(announce)}`);
      else process.stdout.write(c.dim("."));
    }
    await sleep(live ? 250 : 500);
  }
  clearLine();
  throw new CliError("Server did not become healthy within 30 s", {
    code: "START_TIMEOUT",
    hints: [`Check the log: ${LOG_FILE}   (ccam logs)`],
  });
}

/**
 * The port whose registered PID `stop` may signal: the target URL's port, or
 * the protocol default when the URL has none (the same port serverIsUp()
 * probed). Discovery is only consulted when no URL could be parsed.
 */
function stopTargetPort(target, fallback) {
  const urlPort = target ? Number(target.port || (target.protocol === "https:" ? 443 : 80)) : NaN;
  return Number.isInteger(urlPort) && urlPort > 0 ? urlPort : fallback();
}

/**
 * Stop the dashboard server by reading the PID from the discovery file and
 * sending SIGTERM (graceful), escalating to SIGKILL after 5 s. Returns true
 * when a server was stopped.
 */
async function stopServer() {
  if (!(await serverIsUp())) {
    if (isJson()) printJson({ stopped: false, running: false });
    else console.log(`${c.dim("○")} Dashboard is not running — nothing to stop.`);
    return false;
  }
  // Resolve the discovery file and target port the same way baseUrl() does,
  // so `stop` kills the exact server this CLI talks to rather than an
  // arbitrary entry when multiple dashboards run side by side (e.g. the
  // desktop app next to `npm run dev`).
  const { getServerInfoPath, resolveDashboardPort } = require(
    path.join(REPO_ROOT, "server", "lib", "server-info.js")
  );
  const serverInfoPath = getServerInfoPath();
  // Target the exact port this CLI talks to (the one baseUrl() resolves —
  // --server / CCAM_URL, env port, or discovery). A non-local target cannot
  // be stopped by signalling a local PID.
  let target;
  try {
    target = new URL(baseUrl());
  } catch {
    target = null;
  }
  if (target && !["127.0.0.1", "localhost", "[::1]", "::1"].includes(target.hostname)) {
    throw new CliError(
      `Refusing to stop ${target.origin}: only a local dashboard can be stopped.`,
      {
        code: "NOT_LOCAL",
      }
    );
  }
  const targetPort = stopTargetPort(target, resolveDashboardPort);
  let pid;
  let ambiguous = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(serverInfoPath, "utf8"));
    if (Array.isArray(parsed.servers) && parsed.servers.length > 0) {
      const match = parsed.servers.find((s) => s.port === targetPort);
      // With several registered servers and none on our port, guessing could
      // signal an unrelated process — refuse instead.
      if (match) pid = match.pid;
      else if (parsed.servers.length === 1) pid = parsed.servers[0].pid;
      else ambiguous = true;
    } else if (parsed.pid) {
      pid = parsed.pid;
    }
  } catch {
    // fall through
  }
  if (ambiguous) {
    throw new CliError(
      `No registered dashboard on port ${targetPort} in ${serverInfoPath} (several others are).`,
      {
        code: "PID_AMBIGUOUS",
        hints: ["Target one explicitly: DASHBOARD_PORT=<port> ccam stop"],
      }
    );
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new CliError(`Could not determine server PID from ${serverInfoPath}`, {
      code: "PID_UNKNOWN",
      hints: ["Kill it manually: find the node process on port 7770"],
    });
  }
  try {
    process.kill(pid, 0);
  } catch {
    throw new CliError(`PID ${pid} is not running — stale discovery file.`, { code: "STALE_PID" });
  }
  if (!isJson()) console.log(`${c.dim("…")} Stopping dashboard server (pid ${pid})…`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    throw new CliError(`Failed to send SIGTERM: ${err.message}`, { code: "SIGNAL_FAILED" });
  }
  const done = (forced) => {
    if (isJson()) printJson({ stopped: true, pid, forced });
    else console.log(`${c.green("●")} Dashboard stopped${forced ? " (forced)" : ""}.`);
    return true;
  };
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await sleep(300);
    try {
      process.kill(pid, 0);
    } catch {
      return done(false);
    }
  }
  try {
    process.kill(pid, "SIGKILL");
    return done(true);
  } catch (err) {
    // Process exited between the last check and SIGKILL — success
    if (err.code === "ESRCH") return done(false);
    throw new CliError(`Failed to stop dashboard (pid ${pid}): ${err.message}`, {
      code: "SIGNAL_FAILED",
    });
  }
}

async function cmdRestart(opts) {
  await stopServer();
  // Give the port a moment to free up before rebinding.
  for (let i = 0; i < 20 && (await serverIsUp(500)); i++) await sleep(250);
  await startServer(opts);
}

/** Print (and optionally follow) the background server's log file. */
async function cmdLogs(opts) {
  if (!fs.existsSync(LOG_FILE)) {
    throw new CliError(`No server log yet at ${LOG_FILE}`, {
      code: "NO_LOG",
      hints: ["The log is written by `ccam start` (background server)."],
    });
  }
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const n = opts.lines ?? 50;
  process.stdout.write(
    lines.slice(Math.max(0, lines.length - n)).join("\n") + (lines.length ? "\n" : "")
  );
  if (!opts.follow) return;
  let pos = fs.statSync(LOG_FILE).size;
  if (!isJson()) console.error(c.dim(`── following ${LOG_FILE} — Ctrl+C to stop ──`));
  for (;;) {
    await sleep(500);
    let size;
    try {
      size = fs.statSync(LOG_FILE).size;
    } catch {
      continue;
    }
    if (size < pos) pos = 0; // truncated/rotated
    if (size > pos) {
      const fd = fs.openSync(LOG_FILE, "r");
      const buf = Buffer.alloc(size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      process.stdout.write(buf);
      pos = size;
    }
  }
}

/** Dashboard pages `ccam open <page>` understands (client/src/App.tsx routes). */
const PAGES = {
  dashboard: "/",
  kanban: "/kanban",
  sessions: "/sessions",
  activity: "/activity",
  analytics: "/analytics",
  workflows: "/workflows",
  config: "/cc-config",
  run: "/run",
  settings: "/settings",
};

function cmdOpen(page, opts) {
  let route = "/";
  if (opts.session) route = `/sessions/${enc(opts.session)}`;
  else if (page) route = PAGES[page];
  const url = `${baseUrl()}${route === "/" ? "" : route}`;
  if (isJson()) return printJson({ url, opened: !opts.print });
  if (!opts.print) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    const child = spawn(opener, [url], {
      shell: process.platform === "win32",
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  }
  console.log(`${c.green("OK")} ${opts.print ? "" : "Opening "}${url}`);
}

/** `ccam info`-style summary of the CLI's own environment (no server needed). */
function cmdWhere() {
  const data = {
    version: pkgVersion(),
    url: baseUrl(),
    repo_root: REPO_ROOT,
    log_file: LOG_FILE,
    node: process.version,
    token_configured: Boolean(process.env.DASHBOARD_API_TOKEN || process.env.CCAM_API_TOKEN),
  };
  if (isJson()) return printJson(data);
  heading("ccam environment");
  kvCard([
    ["Version", data.version || "?"],
    ["Target", data.url],
    ["Repo", data.repo_root],
    ["Server log", data.log_file],
    ["Node", data.node],
    ["API token", data.token_configured ? c.green("configured") : c.dim("none")],
  ]);
}

function register(program) {
  program
    .command("status")
    .helpGroup(GROUP)
    .description("Up/down indicator for the dashboard server (exit 1 when down)")
    .action(run(cmdStatus));

  program
    .command("health")
    .helpGroup(GROUP)
    .description("Check the dashboard API answers (version + timestamp)")
    .action(
      run(cmdHealth, { serverOnly: "health is, by definition, a check against the running server" })
    );

  program
    .command("start")
    .helpGroup(GROUP)
    .description("Start the server in the background and wait until healthy")
    .option("--port <n>", "port to bind (default 7770)", posIntArg)
    .action(run(({ opts }) => startServer(opts)));

  program
    .command("stop")
    .helpGroup(GROUP)
    .description("Stop the background server gracefully (SIGTERM, then SIGKILL after 5 s)")
    .action(run(() => stopServer()));

  program
    .command("restart")
    .helpGroup(GROUP)
    .description("Stop the server (if running) and start it again in the background")
    .option("--port <n>", "port to bind (default 7770)", posIntArg)
    .action(run(({ opts }) => cmdRestart(opts)));

  program
    .command("logs")
    .helpGroup(GROUP)
    .description("Show the background server log (data/ccam-server.log)")
    .option("-n, --lines <n>", "number of trailing lines to show", intArg, 50)
    .option("-f, --follow", "keep printing new log lines (Ctrl+C stops)")
    .action(run(({ opts }) => cmdLogs(opts)));

  program
    .command("open")
    .helpGroup(GROUP)
    .description("Open the dashboard (or one page / session) in your browser")
    .addArgument(new Argument("[page]", "page to open").choices(Object.keys(PAGES)))
    .option("--session <id>", "open a session's detail page")
    .option("--print", "print the URL instead of opening a browser")
    .action(run(({ args, opts }) => cmdOpen(args[0], opts)));

  program
    .command("where")
    .helpGroup(GROUP)
    .description("Show which dashboard this CLI targets and where its files live")
    .action(run(cmdWhere));
}

module.exports = { register, startServer, stopServer, stopTargetPort };
