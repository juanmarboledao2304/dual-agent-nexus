/**
 * @file phase2-cascade.test.js
 * @description Unit tests for Phase 7 (agy-cascade 3-Pool Waterfall, Cross-CLI Bridge,
 * ===DIGEST=== extraction, Git checkpoint tracking, and ~/.cache/agy-cascade/ cooldown monitor).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
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
