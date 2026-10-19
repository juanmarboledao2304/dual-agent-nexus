/**
 * @file End-to-end regression test for POST /api/simulate/swarm. Drives the real router handler
 * with mocked timers against a throwaway database and asserts the full 25-second lifecycle:
 * L1 Opus Conductor, L2 agy-cascade bridge starting on Pool 1 Opus 5.5 Thinking, Exit Code 10
 * failover to Pool 2 Argon 4 Ultra, three L3 Gemini 3.8 Flash units with git checkpoints, the
 * 4x Grep loop, the y/n permission prompt, and the final ===DIGEST=== handoff. Guards against
 * statement-arity bugs that once made every bridge/fan-out insert throw silently.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const { describe, it, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-sim-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.CLAUDE_HOME = path.join(TMP, "claude");

const { db } = require("../db");
const simulateRouter = require("../controllers/simulateController");
const { clearSimulatedExhaustion } = require("../watchers/cascadeCacheWatcher");

function swarmHandler() {
  const layer = simulateRouter.stack.find(
    (l) => l.route?.path === "/swarm" && l.route.methods.post
  );
  assert.ok(layer, "POST /swarm route must exist");
  return layer.route.stack[0].handle;
}

function startSwarm() {
  let body;
  const res = {
    status() {
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  swarmHandler()({ body: { cwd: "/workspace/demo" } }, res);
  return body;
}

const agentsOf = (sessionId) =>
  db.prepare("SELECT * FROM agents WHERE session_id = ? ORDER BY id").all(sessionId);
const meta = (a) => JSON.parse(a.metadata || "{}");

describe("POST /api/simulate/swarm lifecycle", () => {
  let sim;
  let baseline;
  const errors = [];
  let restoreError;

  before(() => {
    const { cascade } = simulateRouter.getDualQuotaTelemetry();
    baseline = { tokens: cascade.tokens_offloaded, digests: cascade.digest_count };
    mock.timers.enable({ apis: ["setTimeout"] });
    const original = console.error;
    console.error = (...args) => {
      if (String(args[0]).includes("[SWARM-SIM]")) errors.push(args.join(" "));
      else original(...args);
    };
    restoreError = () => {
      console.error = original;
    };
    sim = startSwarm();
  });

  after(() => {
    mock.timers.reset();
    restoreError();
    clearSimulatedExhaustion();
    try {
      db.close();
    } catch {
      /* already closed */
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best-effort temp cleanup (Windows holds the SQLite handle) */
    }
  });

  it("acknowledges a 25-second simulation", () => {
    assert.equal(sim.ok, true);
    assert.equal(sim.duration_ms, 25000);
    assert.match(sim.claude_session_id, /^swarm-claude-/);
  });

  it("starts the L2 bridge on Pool 1 Opus 5.5 Thinking and the Sonnet validator at 4s", () => {
    mock.timers.tick(4100);
    const agents = agentsOf(sim.claude_session_id);
    const bridge = agents.find((a) => a.id.endsWith("-bridge-agy-cascade"));
    assert.ok(bridge, "bridge agent must be created");
    assert.equal(bridge.provider, "agy-claude");
    assert.match(bridge.model, /opus-5-5-thinking/);
    assert.equal(bridge.current_tool, "agy-cascade");
    assert.equal(meta(bridge).hierarchy_level, 2);
    assert.ok(
      agents.some((a) => a.id.endsWith("-sonnet-coder")),
      "Sonnet validator must spawn"
    );
  });

  it("records four consecutive Grep calls from the same Haiku scout", () => {
    mock.timers.tick(3000); // T+7.1s
    const scout = `${sim.claude_session_id}-haiku-explore-2`;
    const tools = db
      .prepare(
        "SELECT tool_name FROM events WHERE agent_id = ? AND event_type = 'PreToolUse' ORDER BY id"
      )
      .all(scout)
      .map((r) => r.tool_name);
    assert.deepEqual(tools.slice(-4), ["Grep", "Grep", "Grep", "Grep"]);
  });

  it("fails the bridge over to Pool 2 Argon 4 Ultra on Exit Code 10", () => {
    mock.timers.tick(500); // T+7.6s
    const bridge = agentsOf(sim.claude_session_id).find((a) =>
      a.id.endsWith("-bridge-agy-cascade")
    );
    assert.equal(bridge.provider, "antigravity");
    assert.equal(bridge.model, "argon-4-ultra");
    assert.equal(bridge.model_tier, "heavy");
    assert.equal(meta(bridge).cascade_exit_code, 10);
    assert.equal(meta(bridge).active_pool, "agy-gemini");
  });

  it("fans out three L3 Gemini 3.8 Flash units under the bridge", () => {
    mock.timers.tick(2500); // T+10.1s
    const agents = agentsOf(sim.claude_session_id);
    const bridge = agents.find((a) => a.id.endsWith("-bridge-agy-cascade"));
    const units = agents.filter((a) => meta(a).hierarchy_level === 3);
    assert.equal(units.length, 3);
    for (const u of units) {
      assert.equal(u.parent_agent_id, bridge.id);
      assert.equal(u.model, "gemini-3.8-flash-high");
      assert.equal(u.status, "working");
    }
  });

  it("blocks the conductor on a y/n permission prompt, then resumes", () => {
    mock.timers.tick(2500); // T+12.6s
    const mainId = `${sim.claude_session_id}-main`;
    const waiting = db.prepare("SELECT * FROM agents WHERE id = ?").get(mainId);
    assert.equal(waiting.awaiting_reason, "notification");
    mock.timers.tick(4500); // T+17.1s
    const resumed = db.prepare("SELECT * FROM agents WHERE id = ?").get(mainId);
    assert.equal(resumed.awaiting_input_since, null);
    assert.equal(resumed.status, "working");
  });

  it("finishes with git checkpoints and a ===DIGEST=== handoff", () => {
    mock.timers.tick(8000); // T+25.1s
    const agents = agentsOf(sim.claude_session_id);
    const units = agents.filter((a) => meta(a).hierarchy_level === 3);
    assert.ok(units.every((u) => u.status === "completed" && meta(u).git_checkpoints === 1));
    const bridge = agents.find((a) => a.id.endsWith("-bridge-agy-cascade"));
    assert.equal(bridge.status, "completed");
    assert.equal(meta(bridge).digest_received, true);
    assert.equal(meta(bridge).offloaded_tokens_saved, 45200);
    assert.equal(meta(bridge).git_checkpoints, 3);
    // The digest is counted exactly once, with the bridge-reported savings.
    const { cascade } = simulateRouter.getDualQuotaTelemetry();
    assert.equal(cascade.digest_count - baseline.digests, 1);
    assert.equal(cascade.tokens_offloaded - baseline.tokens, 45200);
  });

  it("runs every step without a statement error", () => {
    assert.deepEqual(errors, []);
  });
});
