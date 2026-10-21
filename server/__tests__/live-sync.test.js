/**
 * @file Regression tests for keeping the dashboard in step with what Claude Code really reports:
 * the session registry sync (finished background jobs close, jobs asking for a reply surface as
 * "input", idle prompts are not "approval", real names replace "Session xxxxxxxx"), the telemetry
 * status split between waiting_approval and waiting_input, the real subscription limits forwarded by
 * the statusline, the Windows command resolver, and one-shot dispatches that fail visibly instead of
 * faking a run when their CLI is missing.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-live-sync-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "test.db");
process.env.DASHBOARD_DATA_DIR = path.join(TMP, "data");
process.env.DASHBOARD_LIVENESS_PROBE = "0";
process.env.NEXUS_LIVE_SYNC_MS = "0";
process.env.CLAUDE_HOME = path.join(TMP, "claude-home");
delete process.env.NEXUS_DISPATCH_SIMULATE;

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const {
  readLiveClaudeSessions,
  deriveLiveState,
  preferredName,
  createClaudeLiveSync,
  repairClaudeProviderLabels,
} = require("../lib/claude-live-registry");
const { mapTelemetryStatus } = require("../utils/modelClassifier");
const { resolveCommand } = require("../lib/command-resolver");
const { renderLine } = require("../../statusline/nexus-statusline");

let server;
let BASE;

function request(urlPath, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const hook = (hook_type, data) =>
  request("/api/hooks/event", { method: "POST", body: { hook_type, data } });

before(async () => {
  server = await startServer(createApp(), 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

function registryWith(...entries) {
  const sessions = new Map();
  for (const e of entries) {
    sessions.set(e.sessionId, {
      kind: "bg",
      status: "idle",
      waitingFor: null,
      statusUpdatedAt: 0,
      name: "",
      nameSource: null,
      jobId: null,
      jobState: null,
      jobDetail: null,
      cwd: "C:\\work",
      spare: false,
      ...e,
    });
  }
  return () => ({ available: true, sessions });
}

function makeSync(readRegistry) {
  return createClaudeLiveSync({ db, stmts, broadcast: () => {}, readRegistry });
}

describe("telemetry status: approval vs. waiting for a reply", () => {
  it("an ended turn or resumed session is waiting_input, not waiting_approval", () => {
    assert.equal(
      mapTelemetryStatus({ status: "waiting", awaitingInput: true, awaitingReason: "stop" })
        .telemetryStatus,
      "waiting_input"
    );
    assert.equal(
      mapTelemetryStatus({ awaitingInput: true, awaitingReason: "session_start" }).telemetryStatus,
      "waiting_input"
    );
  });

  it("a blocking notification or PermissionRequest is waiting_approval", () => {
    assert.equal(
      mapTelemetryStatus({ awaitingInput: true, awaitingReason: "notification" }).telemetryStatus,
      "waiting_approval"
    );
    assert.equal(
      mapTelemetryStatus({ hookType: "PermissionRequest" }).telemetryStatus,
      "waiting_approval"
    );
  });

  it("a non-blocking notification on a working agent stays working", () => {
    assert.equal(
      mapTelemetryStatus({ hookType: "Notification", status: "working" }).telemetryStatus,
      "thinking"
    );
  });
});

describe("Claude Code registry", () => {
  it("reads live entries with their job state and skips dead pids", () => {
    const home = fs.mkdtempSync(path.join(TMP, "home-"));
    fs.mkdirSync(path.join(home, "sessions"));
    fs.mkdirSync(path.join(home, "jobs", "job1"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "sessions", "100.json"),
      JSON.stringify({ pid: 100, sessionId: "aaa", status: "idle", jobId: "job1", name: "n1" })
    );
    fs.writeFileSync(
      path.join(home, "sessions", "200.json"),
      JSON.stringify({ pid: 200, sessionId: "bbb", status: "busy" })
    );
    fs.writeFileSync(
      path.join(home, "jobs", "job1", "state.json"),
      JSON.stringify({ state: "blocked", detail: "Which branch?" })
    );
    const reg = readLiveClaudeSessions({ home, isAlive: (pid) => pid === 100, env: {} });
    assert.equal(reg.available, true);
    assert.deepEqual([...reg.sessions.keys()], ["aaa"]);
    assert.equal(reg.sessions.get("aaa").jobState, "blocked");
    assert.equal(reg.sessions.get("aaa").jobDetail, "Which branch?");
  });

  it("is unavailable when the registry folder is missing or the probe is disabled", () => {
    assert.equal(
      readLiveClaudeSessions({ home: path.join(TMP, "nope"), env: {} }).available,
      false
    );
    const home = fs.mkdtempSync(path.join(TMP, "home-"));
    fs.mkdirSync(path.join(home, "sessions"));
    assert.equal(
      readLiveClaudeSessions({ home, env: { DASHBOARD_LIVENESS_PROBE: "0" } }).available,
      false
    );
  });

  it("derives the dashboard state from registry + job state", () => {
    assert.deepEqual(deriveLiveState({ status: "busy", jobState: "blocked" }), { kind: "working" });
    assert.equal(deriveLiveState({ status: "idle", jobState: "blocked" }).reason, "job_blocked");
    assert.equal(deriveLiveState({ status: "waiting" }).telemetry, "waiting_approval");
    assert.deepEqual(deriveLiveState({ status: "idle", jobState: "done" }), { kind: "completed" });
    assert.deepEqual(deriveLiveState({ status: "idle", jobState: "failed" }), { kind: "error" });
    assert.equal(deriveLiveState({ status: "idle" }).reason, "stop");
    assert.equal(deriveLiveState({ status: "weird" }), null);
  });

  it("only lets a folder-derived name replace a generic one", () => {
    const e = { sessionId: "12345678-aaaa", jobId: null, name: "claude-20", nameSource: "derived" };
    assert.equal(preferredName(e, "Session 12345678"), "claude-20");
    assert.equal(preferredName(e, "My real title"), null);
    assert.equal(preferredName({ ...e, nameSource: "auto", name: "fix-sync" }, "x"), "fix-sync");
    assert.equal(preferredName({ ...e, name: "12345678" }, "Session 12345678"), null);
  });
});

describe("registry sync against the database", () => {
  it("closes a finished background job and renames it", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    await hook("SessionStart", { session_id: sid, cwd: "C:\\work" });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    const sync = makeSync(
      registryWith({
        sessionId: sid,
        jobId: "j1",
        jobState: "done",
        name: "nice-name",
        nameSource: "auto",
      })
    );
    sync();
    const session = stmts.getSession.get(sid);
    assert.equal(session.status, "completed");
    assert.equal(session.name, "nice-name");
    assert.equal(stmts.getAgent.get(`${sid}-main`).status, "completed");
    // Idempotent: a second pass changes nothing.
    assert.equal(sync().changed, 0);
  });

  it("surfaces a job that asked for a reply as job_blocked / waiting_input", async () => {
    const sid = "22222222-2222-4222-8222-222222222222";
    await hook("SessionStart", { session_id: sid, cwd: "C:\\work" });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    makeSync(registryWith({ sessionId: sid, jobId: "j2", jobState: "blocked" }))();
    const main = stmts.getAgent.get(`${sid}-main`);
    assert.equal(main.status, "waiting");
    assert.equal(main.awaiting_reason, "job_blocked");
    assert.equal(main.telemetry_status, "waiting_input");
  });

  it("turns a stale 'approval' on an idle prompt into a plain wait, and busy back to working", async () => {
    const sid = "33333333-3333-4333-8333-333333333333";
    await hook("SessionStart", { session_id: sid, cwd: "C:\\work" });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    db.prepare("UPDATE agents SET telemetry_status = 'waiting_approval' WHERE id = ?").run(
      `${sid}-main`
    );
    makeSync(registryWith({ sessionId: sid, kind: "interactive", status: "idle" }))();
    let main = stmts.getAgent.get(`${sid}-main`);
    assert.equal(main.status, "waiting");
    assert.equal(main.awaiting_reason, "stop");
    assert.equal(main.telemetry_status, "waiting_input");

    makeSync(registryWith({ sessionId: sid, kind: "interactive", status: "busy" }))();
    main = stmts.getAgent.get(`${sid}-main`);
    assert.equal(main.status, "working");
    assert.equal(main.awaiting_input_since, null);
  });

  it("reopens a closed row whose terminal is still open, but not a finished job", async () => {
    const open = "88888888-8888-4888-8888-888888888888";
    const done = "99999999-9999-4999-8999-999999999999";
    for (const sid of [open, done]) {
      await hook("SessionStart", { session_id: sid, cwd: "C:\\work" });
      await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
      stmts.updateSession.run(null, "completed", new Date().toISOString(), null, sid);
      stmts.updateAgent.run(
        null,
        "completed",
        null,
        null,
        new Date().toISOString(),
        null,
        `${sid}-main`
      );
    }
    makeSync(
      registryWith(
        { sessionId: open, kind: "interactive", status: "idle" },
        { sessionId: done, status: "idle", jobId: "j9", jobState: "done" }
      )
    )();
    const reopened = stmts.getSession.get(open);
    assert.equal(reopened.status, "active");
    assert.equal(reopened.ended_at, null);
    const main = stmts.getAgent.get(`${open}-main`);
    assert.equal(main.status, "waiting");
    assert.equal(main.awaiting_reason, "stop");
    assert.equal(stmts.getSession.get(done).status, "completed");
  });

  it("leaves a status alone while Claude Code is still settling it", async () => {
    const sid = "44444444-4444-4444-8444-444444444444";
    await hook("SessionStart", { session_id: sid, cwd: "C:\\work" });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    makeSync(registryWith({ sessionId: sid, jobState: "done", statusUpdatedAt: Date.now() }))();
    assert.equal(stmts.getSession.get(sid).status, "active");
  });
});

describe("Claude Code sessions on Opus/Sonnet 5.x are not Antigravity", () => {
  const transcriptFor = (sid) =>
    path.join(process.env.CLAUDE_HOME, "projects", "C--work", `${sid}.jsonl`);

  it("labels a hook carrying a Claude projects transcript as claude", async () => {
    const sid = "aaaaaaaa-1111-4111-8111-111111111111";
    await hook("SessionStart", {
      session_id: sid,
      cwd: "C:\\work",
      model: "claude-opus-5-5",
      transcript_path: transcriptFor(sid),
    });
    assert.equal(stmts.getSession.get(sid).provider, "claude");
  });

  it("still infers Pool 1 from the model when nothing proves a Claude Code origin", async () => {
    const sid = "bbbbbbbb-2222-4222-8222-222222222222";
    await hook("SessionStart", { session_id: sid, cwd: "C:\\work", model: "claude-opus-5-5" });
    assert.equal(stmts.getSession.get(sid).provider, "agy-claude");
  });

  it("repairs rows mislabelled before the fix, and only those", async () => {
    const mislabelled = "cccccccc-3333-4333-8333-333333333333";
    const agy = "dddddddd-4444-4444-8444-444444444444";
    for (const sid of [mislabelled, agy]) {
      await hook("SessionStart", { session_id: sid, cwd: "C:\\work", model: "claude-opus-5-5" });
    }
    db.prepare("UPDATE sessions SET transcript_path = ? WHERE id = ?").run(
      transcriptFor(mislabelled),
      mislabelled
    );
    db.prepare("UPDATE sessions SET transcript_path = ? WHERE id = ?").run(
      path.join(TMP, "antigravity", `${agy}.jsonl`),
      agy
    );
    assert.ok(repairClaudeProviderLabels(db) >= 1);
    assert.equal(stmts.getSession.get(mislabelled).provider, "claude");
    assert.equal(stmts.getSession.get(agy).provider, "agy-claude");
    assert.equal(repairClaudeProviderLabels(db), 0);
  });
});

describe("real Claude limits from the statusline", () => {
  it("rejects a payload without usable windows", async () => {
    const res = await request("/api/quota/claude-limits", { method: "POST", body: { foo: 1 } });
    assert.equal(res.status, 400);
  });

  it("stores the limits and the quota uses them instead of the estimate", async () => {
    const resets = Math.round(Date.now() / 1000) + 3600;
    const res = await request("/api/quota/claude-limits", {
      method: "POST",
      body: {
        rate_limits: {
          five_hour: { used_percentage: 42.5, resets_at: resets },
          seven_day: { used_percentage: 10, resets_at: resets + 86400 },
        },
      },
    });
    assert.equal(res.status, 200);
    const quota = (await request("/api/quota")).body;
    assert.equal(quota.claude.window_5h_utilization_pct, 42.5);
    assert.equal(quota.claude.rate_limits.five_hour.used_percentage, 42.5);
    assert.equal(quota.claude.rate_limits.seven_day.used_percentage, 10);
    assert.equal(quota.claude.rate_limits.source, "statusline");
  });

  it("renders a compact statusline", () => {
    const line = renderLine({
      model: { display_name: "Opus 5.5" },
      context_window: { used_percentage: 12.4 },
      rate_limits: { five_hour: { used_percentage: 37, resets_at: Date.now() / 1000 + 600 } },
    });
    assert.match(line, /^Opus 5\.5 · ctx 12% · 5h 37% \(1\dm\)$/);
  });
});

describe("Windows command resolution", () => {
  // Builds real Windows paths on disk, so it only means something on a Windows host.
  it(
    "runs exe directly, bash scripts through Git Bash, and quotes .cmd shims",
    {
      skip: process.platform !== "win32",
    },
    () => {
      const bin = fs.mkdtempSync(path.join(TMP, "bin-"));
      const git = fs.mkdtempSync(path.join(TMP, "git-"));
      fs.mkdirSync(path.join(git, "cmd"));
      fs.mkdirSync(path.join(git, "bin"));
      fs.writeFileSync(path.join(git, "cmd", "git.exe"), "");
      fs.writeFileSync(path.join(git, "bin", "bash.exe"), "");
      fs.writeFileSync(path.join(bin, "tool.exe"), "");
      fs.writeFileSync(path.join(bin, "shim.cmd"), "@echo off");
      fs.writeFileSync(path.join(bin, "script"), "#!/usr/bin/env bash\necho hi\n");
      fs.writeFileSync(path.join(bin, "plain"), "not a script");
      const env = {
        PATH: [bin, path.join(git, "cmd")].join(";"),
        PATHEXT: ".EXE;.CMD",
        ProgramFiles: path.join(TMP, "none"),
      };
      const opts = { platform: "win32", env };

      const exe = resolveCommand("tool", ["-p", "two words"], opts);
      assert.equal(exe.via, "direct");
      assert.equal(exe.shell, false);
      assert.deepEqual(exe.args, ["-p", "two words"]);

      const cmd = resolveCommand("shim", ['say "hi"'], opts);
      assert.equal(cmd.via, "cmd");
      assert.equal(cmd.shell, true);
      assert.deepEqual(cmd.args, ['"say ""hi"""']);

      const script = resolveCommand("script", ["--dir", "x"], opts);
      assert.equal(script.via, "bash");
      assert.equal(script.command, path.win32.resolve(path.join(git, "bin", "bash.exe")));
      assert.equal(script.args[0], path.join(bin, "script").replace(/\\/g, "/"));
      assert.deepEqual(script.args.slice(1), ["--dir", "x"]);

      assert.equal(resolveCommand("plain", [], opts), null);
      assert.equal(resolveCommand("missing", [], opts), null);
    }
  );

  it("leaves non-Windows platforms to the OS", () => {
    const r = resolveCommand("agy-cascade", ["a"], { platform: "linux", env: {} });
    assert.deepEqual(r, {
      command: "agy-cascade",
      args: ["a"],
      shell: false,
      resolved: null,
      via: "direct",
    });
  });
});

describe("one-shot dispatch", () => {
  it("fails visibly when its CLI is missing instead of simulating a run", async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = path.join(TMP, "empty-path");
    try {
      const res = await request("/api/dispatch", {
        method: "POST",
        body: { prompt: "review the repo", engine: "cascade", cwd: TMP },
      });
      assert.equal(res.status, 201);
      const sid = res.body.dispatch.session_id;
      // Windows resolves PATH up front and fails synchronously; elsewhere spawn reports
      // ENOENT asynchronously, so wait for the error to land.
      let session = stmts.getSession.get(sid);
      for (let i = 0; i < 50 && session.status !== "error"; i++) {
        await new Promise((r) => setTimeout(r, 20));
        session = stmts.getSession.get(sid);
      }
      assert.equal(session.status, "error");
      assert.equal(session.awaiting_input_since, null);
      const active = (await request("/api/dispatch/active")).body.dispatches.find(
        (d) => d.session_id === sid
      );
      assert.equal(active.status, "error");
      assert.ok(active.logs.some((l) => /could not be launched|failed to start/.test(l.line)));
      assert.ok(!active.logs.some((l) => /DIGEST|checkpoint/.test(l.line)));
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

describe("liveness reap through the registry (Windows path)", () => {
  it("closes Claude sessions missing from the registry and spares live or foreign ones", async () => {
    const liveness = require("../lib/session-liveness");
    const hooksRouter = require("../routes/hooks");
    const local = process.platform === "win32" ? "C:\\work" : "/work";
    const foreign = process.platform === "win32" ? "/home/remote/work" : "D:\\remote";
    const dead = "55555555-5555-4555-8555-555555555555";
    const alive = "66666666-6666-4666-8666-666666666666";
    const remote = "77777777-7777-4777-8777-777777777777";
    for (const [sid, cwd] of [
      [dead, local],
      [alive, local],
      [remote, foreign],
    ]) {
      await hook("SessionStart", { session_id: sid, cwd });
      await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    }
    const saved = {
      cwds: liveness.probeLiveCwds,
      ids: liveness.probeLiveClaudeSessionIds,
    };
    liveness.probeLiveCwds = () => ({ available: false, cwds: new Set() });
    liveness.probeLiveClaudeSessionIds = () => ({ available: true, ids: new Set([alive]) });
    try {
      hooksRouter.livenessReap({ ignoreIdleGate: true });
    } finally {
      liveness.probeLiveCwds = saved.cwds;
      liveness.probeLiveClaudeSessionIds = saved.ids;
    }
    assert.equal(stmts.getSession.get(dead).status, "completed");
    assert.equal(stmts.getSession.get(alive).status, "active");
    assert.equal(stmts.getSession.get(remote).status, "active");
  });
});
