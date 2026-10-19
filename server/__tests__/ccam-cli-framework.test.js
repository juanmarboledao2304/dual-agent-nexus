/**
 * @file Tests for the Commander-based ccam command framework (cli/) and the
 * command surface added on top of the legacy CLI: command-tree invariants
 * (no subcommand option may shadow a global option, every command is
 * described), the Cobra-style completion protocol, the machine-readable
 * command schema, JSON output + JSON error contracts for agents, and the new
 * resource subcommands (sessions/agents/events detail and writes, alert-rule
 * and webhook flag-based writes, GPT/Cursor rate cards with merge semantics,
 * remote-source toggles, homes, metrics, transcripts, export to stdout).
 *
 * Like ccam-cli.test.js, the CLI is spawned ASYNCHRONOUSLY against a live
 * in-test server (a synchronous spawn would deadlock the in-process server).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const STAMP = `ccam-fw-${Date.now()}-${process.pid}`;
const TMP = path.join(os.tmpdir(), STAMP);
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.CLAUDE_HOME = path.join(TMP, "home");
process.env.DASHBOARD_DATA_DIR = path.join(TMP, "data");
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db } = require("../db");
const { getUpdatesStatus } = require("../lib/update-check");
const { buildProgram } = require("../../cli/index");
const { completeWords, describeCommand } = require("../../cli/lib/framework");
const { parsePrometheus } = require("../../cli/commands/admin");

const CLI = path.resolve(__dirname, "..", "..", "bin", "ccam.js");
const SESSION = "fw-test-session-0001";

let server;
let PORT;

function ccam(...args) {
  return ccamEnv({}, ...args);
}

function ccamEnv(env, ...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, DASHBOARD_PORT: String(PORT), ...env },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ code, out, err });
    });
  });
}

async function hook(hook_type, data) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/hooks/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hook_type, data }),
  });
  assert.equal(res.status, 200);
}

before(async () => {
  const app = createApp();
  app.locals.updateStatusProvider = () => getUpdatesStatus(undefined, { skipFetch: true });
  server = await startServer(app, 0);
  PORT = server.address().port;
  await hook("SessionStart", { session_id: SESSION, cwd: "/tmp/ccam-fw" });
  await hook("PreToolUse", {
    session_id: SESSION,
    tool_name: "Bash",
    tool_input: { command: "ls" },
  });
  await hook("PostToolUse", {
    session_id: SESSION,
    tool_name: "Bash",
    tool_input: { command: "ls" },
  });
  // A real Claude transcript for the chat-log renderer.
  const dir = path.join(process.env.CLAUDE_HOME, "projects", "-tmp-ccam-fw");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${SESSION}.jsonl`),
    [
      {
        type: "user",
        message: { role: "user", content: "List the files please" },
        timestamp: "2026-01-01T00:00:00Z",
        uuid: "u1",
      },
      {
        type: "assistant",
        message: {
          id: "m1",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [
            { type: "text", text: "Listing now." },
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } },
          ],
        },
        timestamp: "2026-01-01T00:00:01Z",
        uuid: "a1",
      },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n"
  );
});

after(() => {
  if (server) server.close();
  if (db) db.close();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ── Command-tree invariants (in-process, no server needed) ─────────────────

describe("ccam framework — command tree", () => {
  const program = buildProgram();
  const all = [];
  const walk = (cmd) => {
    for (const s of cmd.commands) {
      all.push(s);
      walk(s);
    }
  };
  walk(program);

  it("no subcommand option shadows a global option (the root would swallow it)", () => {
    const globals = new Set(program.options.flatMap((o) => [o.long, o.short].filter(Boolean)));
    for (const cmd of all) {
      for (const o of cmd.options) {
        for (const flag of [o.long, o.short].filter(Boolean)) {
          assert.ok(
            !globals.has(flag),
            `${cmd.commandPath()} ${flag} collides with a global option`
          );
        }
      }
    }
  });

  it("every visible command has a description", () => {
    for (const cmd of all.filter((c) => !c._hidden)) {
      assert.ok(cmd.description(), `${cmd.commandPath()} is missing a description`);
    }
  });

  it("every top-level command belongs to a help group", () => {
    for (const cmd of program.commands) {
      assert.ok(cmd.helpGroup(), `${cmd.name()} has no help group`);
    }
  });

  it("covers the full dashboard surface", () => {
    const paths = new Set(all.map((c) => c.commandPath().replace(/^ccam /, "")));
    for (const p of [
      "sessions get",
      "sessions stats",
      "sessions transcript",
      "sessions rename",
      "agents update",
      "events facets",
      "overview",
      "stream",
      "runs get",
      "run follow",
      "alert-rules enable",
      "webhooks create",
      "pricing gpt set",
      "pricing cursor set",
      "remote-sources enable",
      "import reimport",
      "home set",
      "push send",
      "updates check",
      "metrics",
      "completion",
      "commands",
      "restart",
      "logs",
    ]) {
      assert.ok(paths.has(p), `missing command: ccam ${p}`);
    }
  });

  it("completeWords completes subcommands, options, and choices at any depth", () => {
    assert.ok(completeWords(program, ["sess"]).includes("sessions"));
    assert.ok(completeWords(program, ["sessions", ""]).includes("transcript"));
    assert.deepEqual(completeWords(program, ["sessions", "--st"]), ["--status"]);
    assert.ok(completeWords(program, ["sessions", "--status", ""]).includes("completed"));
    assert.deepEqual(completeWords(program, ["completion", ""]), ["bash", "zsh", "fish"]);
    // Sibling list flags do not leak into other subcommands; globals do.
    const ackFlags = completeWords(program, ["alerts", "ack", "--"]);
    assert.ok(!ackFlags.includes("--unacked"));
    assert.ok(ackFlags.includes("--json"));
  });

  it("describeCommand emits a machine-readable schema", () => {
    const schema = describeCommand(program);
    const sessions = schema.commands.find((c) => c.name === "sessions");
    assert.ok(sessions.options.some((o) => o.name === "status" && o.choices.includes("active")));
    const get = sessions.commands.find((c) => c.name === "get");
    assert.deepEqual(get.aliases, ["show"]);
    assert.equal(get.arguments[0].name, "id");
    assert.equal(get.arguments[0].required, true);
  });

  it("parsePrometheus reads names, labels, and values", () => {
    const samples = parsePrometheus('# HELP x\nccam_up 1\nccam_sessions{status="active"} 3\n');
    assert.deepEqual(samples, [
      { name: "ccam_up", labels: {}, value: 1 },
      { name: "ccam_sessions", labels: { status: "active" }, value: 3 },
    ]);
  });
});

// ── Machine-readable contracts ─────────────────────────────────────────────

describe("ccam framework — JSON for agents", () => {
  it("--json works on table commands and anywhere on the line", async () => {
    for (const args of [
      ["sessions", "--json"],
      ["--json", "stats"],
      ["alerts", "--json"],
      ["pricing", "--json"],
    ]) {
      const { code, out } = await ccam(...args);
      assert.equal(code, 0, args.join(" "));
      assert.doesNotThrow(() => JSON.parse(out), `${args.join(" ")} should print JSON`);
      assert.ok(!out.includes("\x1b["));
    }
  });

  it("CCAM_OUTPUT=json switches the default output", async () => {
    const { code, out } = await ccamEnv({ CCAM_OUTPUT: "json" }, "sessions");
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).total, 1);
  });

  it("errors are a JSON document on stderr in JSON mode", async () => {
    const unknown = await ccam("frobnicate", "--json");
    assert.equal(unknown.code, 1);
    assert.equal(JSON.parse(unknown.err).error.code, "UNKNOWN_COMMAND");
    const missing = await ccam("session", "--json");
    assert.equal(JSON.parse(missing.err).error.code, "MISSING_ARGUMENT");
    const notFound = await ccam("session", "nope", "--json");
    assert.equal(notFound.code, 1);
    assert.equal(JSON.parse(notFound.err).error.status, 404);
    const refused = await ccam(
      "alert-rules",
      "create",
      "--name",
      "x",
      "--type",
      "inactivity",
      "--json"
    );
    assert.equal(JSON.parse(refused.err).error.code, "CONFIRMATION_REQUIRED");
  });

  it("server-down is reported as SERVER_DOWN JSON", async () => {
    const { code, err } = await ccamEnv({ DASHBOARD_PORT: "1" }, "cost", "--json");
    assert.equal(code, 1);
    const e = JSON.parse(err).error;
    assert.equal(e.code, "SERVER_DOWN");
    assert.match(e.reason, /runs server-side/);
  });

  it("commands --json describes the whole tree", async () => {
    const { code, out } = await ccam("commands", "--json");
    assert.equal(code, 0);
    const tree = JSON.parse(out);
    assert.ok(tree.version);
    assert.ok(
      tree.commands.find((c) => c.name === "webhooks").commands.some((c) => c.name === "create")
    );
  });

  it("version --json and overview --json are structured", async () => {
    assert.equal(JSON.parse((await ccam("version", "--json")).out).name, "ccam");
    const o = JSON.parse((await ccam("overview", "--json")).out);
    assert.ok(o.stats);
    assert.ok(Array.isArray(o.active_sessions));
  });
});

describe("ccam framework — stop target", () => {
  it("uses the URL port, else the protocol default, before discovery", () => {
    const { stopTargetPort } = require("../../cli/commands/server");
    const fallback = () => 7770;
    assert.equal(stopTargetPort(new URL("http://127.0.0.1:4899"), fallback), 4899);
    assert.equal(stopTargetPort(new URL("http://localhost"), fallback), 80);
    assert.equal(stopTargetPort(new URL("https://localhost"), fallback), 443);
    assert.equal(stopTargetPort(null, fallback), 7770);
  });
});

describe("ccam framework — HTTP client", () => {
  it("a slow server is a TIMEOUT error, not a server-down fallback", async () => {
    const http = require("http");
    const { state, CliError, ServerDownError } = require("../../cli/lib/runtime");
    const { get } = require("../../cli/lib/http");
    const hang = http.createServer(() => {}); // accepts, never answers
    await new Promise((r) => hang.listen(0, "127.0.0.1", r));
    const previous = state.url;
    state.url = `http://127.0.0.1:${hang.address().port}`;
    try {
      await assert.rejects(get("/api/health", { timeoutMs: 150 }), (err) => {
        assert.ok(err instanceof CliError);
        assert.ok(!(err instanceof ServerDownError));
        assert.equal(err.code, "TIMEOUT");
        return true;
      });
    } finally {
      state.url = previous;
      hang.closeAllConnections();
      hang.close();
    }
  });
});

// ── Human UX ────────────────────────────────────────────────────────────────

describe("ccam framework — help, usage errors, completion", () => {
  it("help works for nested command paths", async () => {
    const { code, out } = await ccam("help", "alerts", "ack");
    assert.equal(code, 0);
    assert.match(out, /Usage: ccam alerts ack/);
    assert.doesNotMatch(out, /--unacked/); // group flags are not "global"
  });

  it("usage errors name the command and show its usage line", async () => {
    const r = await ccam("alerts", "ack");
    assert.equal(r.code, 1);
    assert.match(r.err, /ack requires an alert id/);
    assert.match(r.err, /Usage: ccam alerts ack/);
    const bad = await ccam("sessions", "--limit", "abc");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /whole number/);
  });

  it("completion scripts and the __complete protocol", async () => {
    for (const shell of ["bash", "zsh", "fish"]) {
      const { code, out } = await ccam("completion", shell);
      assert.equal(code, 0);
      assert.match(out, /__complete/);
    }
    const { out } = await ccam("__complete", "sessions", "--st");
    assert.equal(out.trim(), "--status");
  });

  it("open --print resolves page and session URLs", async () => {
    assert.match((await ccam("open", "analytics", "--print")).out, new RegExp(`${PORT}/analytics`));
    assert.match(
      (await ccam("open", "--session", SESSION, "--print")).out,
      new RegExp(`/sessions/${SESSION}`)
    );
  });
});

// ── New resource commands ───────────────────────────────────────────────────

describe("ccam framework — sessions, agents, events", () => {
  it("sessions get / stats / facets / agents", async () => {
    assert.match((await ccam("sessions", "get", SESSION)).out, /Recent events/);
    const stats = await ccam("sessions", "stats", SESSION);
    assert.equal(stats.code, 0);
    assert.match(stats.out, /Bash/);
    assert.match((await ccam("sessions", "facets")).out, /\/tmp\/ccam-fw/);
    assert.match((await ccam("sessions", "agents", SESSION)).out, /Agents/);
  });

  it("sessions transcript renders a chat log; --json keeps the DTO", async () => {
    const text = await ccam("sessions", "transcript", SESSION);
    assert.equal(text.code, 0);
    assert.match(text.out, /List the files please/);
    assert.match(text.out, /⚙ Bash/);
    const raw = await ccam("sessions", "transcript", SESSION, "--json");
    assert.ok(Array.isArray(JSON.parse(raw.out).messages));
  });

  it("sessions rename requires confirmation, then renames", async () => {
    const refused = await ccam("sessions", "rename", SESSION, "New", "name");
    assert.equal(refused.code, 1);
    assert.match(refused.err, /require --yes/);
    const ok = await ccam("sessions", "rename", SESSION, "New", "name", "--yes");
    assert.equal(ok.code, 0, ok.err);
    assert.equal(
      db.prepare("SELECT name FROM sessions WHERE id = ?").get(SESSION).name,
      "New name"
    );
  });

  it("agents get / update", async () => {
    const id = `${SESSION}-main`;
    assert.match((await ccam("agents", "get", id)).out, /Status/);
    const upd = await ccam("agents", "update", id, "--task", "Refactor", "--yes");
    assert.equal(upd.code, 0, upd.err);
    assert.equal(db.prepare("SELECT task FROM agents WHERE id = ?").get(id).task, "Refactor");
  });

  it("events filters and facets", async () => {
    const r = await ccam("events", "--type", "PreToolUse", "--json");
    const events = JSON.parse(r.out).events;
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => e.event_type === "PreToolUse"));
    assert.match((await ccam("events", "facets")).out, /Bash/);
  });
});

describe("ccam framework — alert rules & webhooks", () => {
  it("alert-rules create with field flags, update merges config, toggle, delete", async () => {
    const created = await ccam(
      "alert-rules",
      "create",
      "--name",
      "Waiting too long",
      "--type",
      "status_duration",
      "--agent-status",
      "waiting",
      "--minutes",
      "15",
      "--json",
      "--yes"
    );
    assert.equal(created.code, 0, created.err);
    const id = JSON.parse(created.out).rule.id;
    const upd = await ccam("alert-rules", "update", id, "--minutes", "5", "--yes");
    assert.equal(upd.code, 0, upd.err);
    const row = db.prepare("SELECT config, enabled FROM alert_rules WHERE id = ?").get(id);
    assert.deepEqual(JSON.parse(row.config), { status: "waiting", minutes: 5 });
    assert.equal((await ccam("alert-rules", "disable", id, "--yes")).code, 0);
    assert.equal(db.prepare("SELECT enabled FROM alert_rules WHERE id = ?").get(id).enabled, 0);
    assert.equal((await ccam("alert-rules", "delete", id, "--yes")).code, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM alert_rules WHERE id = ?").get(id).n, 0);
  });

  it("alert-rules types lists every rule type", async () => {
    const { out } = await ccam("alert-rules", "types", "--json");
    assert.deepEqual(Object.keys(JSON.parse(out).rule_types).sort(), [
      "event_pattern",
      "inactivity",
      "status_duration",
      "token_threshold",
    ]);
  });

  it("webhooks create --url targets the webhook, not the dashboard", async () => {
    const created = await ccam(
      "webhooks",
      "create",
      "--name",
      "FW hook",
      "--type",
      "generic",
      "--url",
      "https://example.com/hook",
      "--header",
      "X-Env=test",
      "--disabled",
      "--yes",
      "--json"
    );
    assert.equal(created.code, 0, created.err);
    const target = JSON.parse(created.out).target;
    assert.equal(target.enabled, false);
    assert.match((await ccam("webhooks", "get", target.id)).out, /X-Env/);
    assert.equal((await ccam("webhooks", "enable", target.id, "--yes")).code, 0);
    assert.equal((await ccam("webhooks", "delete", target.id, "--yes")).code, 0);
  });
});

describe("ccam framework — pricing rate cards, remotes, admin", () => {
  it("pricing gpt set merges flags onto the existing row", async () => {
    assert.equal(
      (await ccam("pricing", "gpt", "set", "fw-gpt%", "--input", "2", "--output", "8", "--yes"))
        .code,
      0
    );
    assert.equal(
      (await ccam("pricing", "gpt", "set", "fw-gpt%", "--output", "9", "--yes")).code,
      0
    );
    const row = db
      .prepare("SELECT * FROM gpt_model_pricing WHERE model_pattern = ?")
      .get("fw-gpt%");
    assert.equal(row.short_input_per_mtok, 2); // preserved
    assert.equal(row.short_output_per_mtok, 9); // updated
    assert.equal((await ccam("pricing", "gpt", "delete", "fw-gpt%", "--yes")).code, 0);
  });

  it("pricing set keeps the rule's other rates on a partial edit", async () => {
    const created = await ccam(
      "pricing",
      "set",
      "fw-claude%",
      "--input",
      "3",
      "--output",
      "15",
      "--fast-input",
      "6",
      "--fast-output",
      "30"
    );
    assert.equal(created.code, 0, created.err);
    assert.equal((await ccam("pricing", "set", "fw-claude%", "--input", "4")).code, 0);
    const row = db.prepare("SELECT * FROM model_pricing WHERE model_pattern = ?").get("fw-claude%");
    assert.equal(row.input_per_mtok, 4); // updated
    assert.equal(row.output_per_mtok, 15); // preserved
    assert.equal(row.fast_input_per_mtok, 6); // preserved
    assert.equal((await ccam("pricing", "delete", "fw-claude%")).code, 0);
  });

  it("pricing cursor lists the Cursor rate card", async () => {
    const { code, out } = await ccam("pricing", "cursor", "--json");
    assert.equal(code, 0);
    assert.ok(Array.isArray(JSON.parse(out).pricing));
  });

  it("pricing reset is gated by confirmation", async () => {
    const r = await ccam("pricing", "reset");
    assert.equal(r.code, 1);
    assert.match(r.err, /requires --yes/);
  });

  it("remote-sources enable / disable / get / rm", async () => {
    const added = await ccam(
      "remote-sources",
      "add",
      "--label",
      "FW box",
      "--host",
      "fw@box",
      "--disabled",
      "--json"
    );
    const id = JSON.parse(added.out).source.id;
    const refused = await ccam("remote-sources", "enable", id);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /requires --yes/);
    assert.equal((await ccam("remote-sources", "enable", id, "--yes")).code, 0);
    assert.equal(db.prepare("SELECT enabled FROM remote_sources WHERE id = ?").get(id).enabled, 1);
    assert.equal((await ccam("remote-sources", "disable", id, "--yes")).code, 0);
    assert.match((await ccam("remote-sources", "get", "FW box")).out, /fw@box/);
    assert.equal((await ccam("remote-sources", "rm", id)).code, 0);
  });

  it("home, metrics --json, updates, api shorthand, export to stdout", async () => {
    const home = JSON.parse((await ccam("home", "--json")).out);
    assert.equal(home.claude_home, process.env.CLAUDE_HOME);
    const metrics = JSON.parse((await ccam("metrics", "--json", "--grep", "ccam_up")).out);
    assert.ok(metrics.samples.some((s) => s.name === "ccam_up"));
    assert.equal((await ccam("updates")).code, 0);
    assert.equal(JSON.parse((await ccam("api", "/api/health")).out).status, "ok");
    const exported = await ccam("export", "-");
    assert.ok(JSON.parse(exported.out).sessions.some((s) => s.id === SESSION));
  });

  it("doctor --json returns structured checks", async () => {
    const { out } = await ccam("doctor", "--json");
    const report = JSON.parse(out);
    assert.ok(report.checks.some((k) => k.name === "API reachable" && k.status === "ok"));
    assert.ok(report.checks.some((k) => k.name === "Database"));
  });
});
