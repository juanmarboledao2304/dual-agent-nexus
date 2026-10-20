/**
 * @file phase2-cascade.test.js
 * @description Unit tests for Phase 7 (agy-cascade 3-Pool Waterfall, Cross-CLI Bridge,
 * ===DIGEST=== extraction, Git checkpoint tracking, and ~/.cache/agy-cascade/ cooldown monitor).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Isolate the cooldown tests from the machine's real ~/.cache/agy-cascade, where a live
// agy-cascade run may have left *.exhausted markers.
process.env.AGY_CASCADE_CACHE_DIR = require("node:fs").mkdtempSync(
  require("node:path").join(require("node:os").tmpdir(), "agy-cascade-test-")
);

const {
  classifyModelAndEffort,
  resolveQuotaPool,
  extractDigestBlock,
  extractGitCheckpoints,
  parseAgyBridgeCommand,
  DEFAULT_CASCADE_MODELS,
} = require("../utils/modelClassifier");
const {
  getCascadeStatus,
  triggerSimulatedExhaustion,
  clearSimulatedExhaustion,
  recordOffloadedDigest,
} = require("../watchers/cascadeCacheWatcher");
const { parseProviders, providerColumnClause } = require("../lib/provider-filter");

describe("Phase 7 — 3-Pool Model Classifier & Waterfall Telemetry", () => {
  it("classifies Pool 1 (agy-claude) models with Electric Fuchsia / Neon Indigo metadata", () => {
    const opus55 = classifyModelAndEffort({
      model: "claude-opus-5-5-thinking",
      provider: "agy-claude",
    });
    assert.equal(opus55.provider, "agy-claude");
    assert.equal(opus55.pool, "agy-claude");
    assert.equal(opus55.model_tier, "heavy");

    const sonnet55 = classifyModelAndEffort({
      model: "claude-sonnet-5-5-thinking",
      provider: "agy-claude",
    });
    assert.equal(sonnet55.provider, "agy-claude");
    assert.equal(sonnet55.pool, "agy-claude");
    assert.equal(sonnet55.model_tier, "standard");

    const gptOss = classifyModelAndEffort({
      model: "gpt-oss-120b-medium",
    });
    assert.equal(gptOss.provider, "agy-claude");
    assert.equal(gptOss.pool, "agy-claude");
    assert.equal(gptOss.model_tier, "standard");
  });

  it("classifies Pool 2 (agy-gemini / antigravity) models", () => {
    const flash38 = classifyModelAndEffort({
      model: "gemini-3.8-flash-high",
    });
    assert.equal(flash38.provider, "antigravity");
    assert.equal(flash38.pool, "agy-gemini");
    assert.equal(flash38.model_tier, "light");

    const argon = classifyModelAndEffort({
      model: "argon-4-ultra",
    });
    assert.equal(argon.provider, "antigravity");
    assert.equal(argon.pool, "agy-gemini");
    assert.equal(argon.model_tier, "heavy");
  });

  it("classifies Pool 3 (claude-direct) models", () => {
    const opus46 = classifyModelAndEffort({
      model: "claude-opus-4-6",
      provider: "claude",
    });
    assert.equal(opus46.provider, "claude");
    assert.equal(opus46.pool, "claude-direct");
    assert.equal(opus46.model_tier, "heavy");
  });

  it("keeps Claude Code sessions on Opus/Sonnet 5.5 in Pool 3 when the provider is explicit", () => {
    // Claude Code runs 5.5-generation models directly on the Anthropic subscription and its
    // hooks always report provider "claude"; only Antigravity or provider-less rows map to Pool 1.
    for (const model of ["claude-opus-5-5", "claude-sonnet-5-5-thinking"]) {
      const direct = classifyModelAndEffort({ model, provider: "claude" });
      assert.equal(direct.provider, "claude", model);
      assert.equal(direct.pool, "claude-direct", model);
    }
    assert.equal(resolveQuotaPool("claude", "claude-opus-5-5"), "claude-direct");
    assert.equal(resolveQuotaPool("antigravity", "claude-opus-5-5-thinking"), "agy-claude");
    assert.equal(resolveQuotaPool(undefined, "claude-opus-5-5-thinking"), "agy-claude");
  });

  it("exports DEFAULT_CASCADE_MODELS in priority order", () => {
    assert.ok(Array.isArray(DEFAULT_CASCADE_MODELS));
    assert.ok(DEFAULT_CASCADE_MODELS.length >= 4);
    assert.equal(DEFAULT_CASCADE_MODELS[0].pool, "agy-claude");
    assert.equal(resolveQuotaPool("agy-claude", "claude-opus-5-5-thinking"), "agy-claude");
    assert.equal(resolveQuotaPool("antigravity", "gemini-3.8-flash-high"), "agy-gemini");
  });
});

describe("Phase 7 — ===DIGEST===, Git Checkpoints & Cross-CLI Bridge Parsers", () => {
  it("extracts structured ===DIGEST=== blocks and computes offloaded token savings", () => {
    const sample = [
      "Completed 3x specialist subagent fan-out.",
      "===DIGEST===",
      "- Status: SUCCESS",
      "- Files Touched: server/routes/hooks.js, client/src/components/SubagentGraph.tsx",
      "- Key Findings: Zero XSS or injection vectors; 3-level hierarchy verified.",
      "- Follow-Ups: Run git diff verification.",
    ].join("\n");

    const digest = extractDigestBlock(sample, { explicitSavedTokens: 45200 });
    assert.ok(digest);
    assert.equal(digest.hasDigest, true);
    assert.match(digest.digestText, /Status: SUCCESS/);
    assert.match(digest.digestText, /Zero XSS/);
    assert.equal(digest.savedTokens, 45200);
  });

  it("extracts git checkpoint commit messages from command or output text", () => {
    const text = `git add -A && git commit -m "checkpoint: pre-agy-cascade"\ngit commit -m 'checkpoint: security-audit-done'`;
    const commits = extractGitCheckpoints(text);
    assert.equal(commits.count, 2);
    assert.deepEqual(commits.messages, [
      "checkpoint: pre-agy-cascade",
      "checkpoint: security-audit-done",
    ]);
  });

  it("detects Cross-CLI Bridge commands (agy-cascade / agy-delegate / agy-job)", () => {
    const cmd = `~/.local/bin/agy-cascade --yolo --dir /workspace/app "Audit security and performance"`;
    const parsed = parseAgyBridgeCommand(cmd);
    assert.ok(parsed);
    assert.equal(parsed.bridgeTool, "agy-cascade");
    assert.equal(parsed.yolo, true);
    assert.equal(parsed.workspaceDir, "/workspace/app");
    assert.match(parsed.prompt, /Audit security and performance/);
  });
});

describe("Phase 7 — ~/.cache/agy-cascade/ Cooldown & Provider Filter", () => {
  it("tracks Pool 1 exhaustion (Exit Code 10) and cascades active_pool to Pool 2", () => {
    clearSimulatedExhaustion();
    const initial = getCascadeStatus();
    assert.equal(initial.active_pool, "agy-claude");

    triggerSimulatedExhaustion("claude", 1800);
    const cascaded = getCascadeStatus();
    assert.equal(cascaded.pools.claude.exhausted, true);
    assert.ok(cascaded.pools.claude.remaining_seconds > 1700);
    assert.equal(cascaded.active_pool, "agy-gemini");
    assert.equal(cascaded.active_pool_id, "agy-gemini");

    recordOffloadedDigest({ savedTokens: 45200, digestText: "SUCCESS" });
    const afterDigest = getCascadeStatus();
    assert.ok(afterDigest.tokens_offloaded >= 45200);

    clearSimulatedExhaustion();
  });

  it("includes agy-claude and agy-gemini in provider filter", () => {
    const providers = parseProviders({ query: { providers: "claude" } });
    assert.ok(providers.includes("claude"));
    assert.ok(providers.includes("antigravity"));
    assert.ok(providers.includes("agy-claude"));
    assert.ok(providers.includes("agy-gemini"));
    const sqlClause = providerColumnClause(providers, "s.provider");
    assert.ok(sqlClause.params.includes("agy-claude"));
    assert.ok(sqlClause.params.includes("agy-gemini"));
  });
});

describe("DualAgent Nexus v3 — port 7770, hook migration, simulator, authorship", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const REPO_ROOT = path.join(__dirname, "..", "..");

  it("defaults the dashboard and hook transport to port 7770", () => {
    const { DEFAULT_PORT } = require("../lib/server-info");
    assert.equal(DEFAULT_PORT, 7770);
    const indexSrc = fs.readFileSync(path.join(REPO_ROOT, "server", "index.js"), "utf8");
    assert.match(indexSrc, /process\.env\.DASHBOARD_PORT \|\| "7770"/);
  });

  it("migrates curl hooks installed for the old 4820 port instead of duplicating them", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-hooks-"));
    const prevHome = process.env.CLAUDE_HOME;
    const prevGemini = process.env.GEMINI_HOOKS_PATH;
    process.env.CLAUDE_HOME = tmp;
    process.env.GEMINI_HOOKS_PATH = path.join(tmp, "hooks.json");
    try {
      const legacy =
        "curl -s -X POST http://127.0.0.1:4820/api/events?provider=antigravity -H 'Content-Type: application/json' -d @- > /dev/null 2>&1 &";
      fs.writeFileSync(
        process.env.GEMINI_HOOKS_PATH,
        JSON.stringify({
          hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: legacy }] }] },
        })
      );
      const installer = require("../../scripts/install-hooks");
      assert.match(installer.ANTIGRAVITY_CURL_CMD, /127\.0\.0\.1:7770\/api\/events/);
      assert.match(installer.CLAUDE_CURL_CMD, /127\.0\.0\.1:7770\/api\/events/);
      installer.installAntigravityHooks(true);
      const written = JSON.parse(fs.readFileSync(process.env.GEMINI_HOOKS_PATH, "utf8"));
      assert.equal(written.hooks.Stop.length, 1);
      assert.match(written.hooks.Stop[0].hooks[0].command, /127\.0\.0\.1:7770\/api\/events/);
      assert.doesNotMatch(JSON.stringify(written), /:4820/);
    } finally {
      if (prevHome === undefined) delete process.env.CLAUDE_HOME;
      else process.env.CLAUDE_HOME = prevHome;
      if (prevGemini === undefined) delete process.env.GEMINI_HOOKS_PATH;
      else process.env.GEMINI_HOOKS_PATH = prevGemini;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("starts the simulated L2 bridge on Pool 1 Opus 5.5 Thinking", () => {
    const parsed = parseAgyBridgeCommand(
      `agy-cascade --dir "/w" --model claude-opus-5-5-thinking --yolo --digest "Execute 3-unit fan-out via invoke_subagent"`
    );
    assert.equal(parsed.model, "claude-opus-5-5-thinking");
    assert.equal(parsed.isFanOut, true);
    const bridge = classifyModelAndEffort({ model: parsed.model, provider: "agy-claude" });
    assert.equal(bridge.pool, "agy-claude");
    assert.equal(bridge.model_tier, "heavy");
  });

  it("drives the specified waterfall and keeps simulator output emoji-free", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server", "controllers", "simulateController.js"),
      "utf8"
    );
    assert.match(src, /--model claude-opus-5-5-thinking/);
    assert.match(src, /agy-cascade \(Pool 2: Argon 4 Ultra\)/);
    assert.match(src, /meta\.cascade_exit_code = 10/);
    assert.match(src, /notification_type: "permission_prompt"/);
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const rel of ["simulateController.js", "dispatchController.js"]) {
      const text = fs.readFileSync(path.join(REPO_ROOT, "server", "controllers", rel), "utf8");
      assert.doesNotMatch(text, emoji, `${rel} contains an emoji`);
    }
  });

  it("credits Juan Manuel Arboleda Orozco as author while keeping upstream attribution", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(pkg.name, "dual-agent-nexus");
    assert.match(pkg.author, /^Juan Manuel Arboleda Orozco/);
    assert.match(pkg.repository.url, /juanmarboledao2304\/dual-agent-nexus/);
    const license = fs.readFileSync(path.join(REPO_ROOT, "LICENSE"), "utf8");
    assert.match(license, /Juan Manuel Arboleda Orozco/);
    assert.match(license, /Son Nguyen/);
  });
});
