/**
 * @file Watcher for ~/.cache/agy-cascade state files (models.list, claude.exhausted, gemini.exhausted) and ===DIGEST=== token offload telemetry.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { DEFAULT_CASCADE_MODELS, classifyModelAndEffort } = require("../utils/modelClassifier");

const COOLDOWN_WINDOW_SECONDS = 1800; // 30-minute (1800s) pool cooldown window

const simulatedExhaustion = {
  "agy-claude": { untilMs: 0, exitCode: 10, reason: null, cascadedTo: null },
  "agy-gemini": { untilMs: 0, exitCode: 10, reason: null, cascadedTo: null },
};

const digestStats = {
  offloadedTokensSaved: 0,
  digestCount: 0,
  lastDigestAt: null,
  lastDigestPreview: null,
  activeModel: null,
  activePool: "agy-claude",
};

let watcherInterval = null;
let lastBroadcastSignature = "";
let registeredBroadcast = null;
let registeredDb = null;

/**
 * Resolve the `~/.cache/agy-cascade` directory path.
 */
function getCascadeCacheDir() {
  if (process.env.AGY_CASCADE_CACHE_DIR) {
    return path.resolve(process.env.AGY_CASCADE_CACHE_DIR);
  }
  return path.join(os.homedir(), ".cache", "agy-cascade");
}

/**
 * Parse `~/.cache/agy-cascade/models.list` if present, or return the canonical 3-pool waterfall list.
 */
function readCascadeModelsList() {
  const cacheDir = getCascadeCacheDir();
  const listPath = path.join(cacheDir, "models.list");
  try {
    if (!fs.existsSync(listPath)) {
      return DEFAULT_CASCADE_MODELS;
    }
    const raw = fs.readFileSync(listPath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return DEFAULT_CASCADE_MODELS;
    }
    return lines.map((entry) => {
      const classified = classifyModelAndEffort({
        model: entry,
        source: "agy-cascade",
      });
      return {
        pool: classified.pool,
        provider: classified.provider,
        model: entry,
        label: classified.model_short,
        tier: classified.model_tier,
        effort: classified.effort,
      };
    });
  } catch {
    return DEFAULT_CASCADE_MODELS;
  }
}

/**
 * Read a `.exhausted` lockfile and compute remaining cooldown seconds out of 1800s.
 * @param {string} filename
 * @param {'agy-claude' | 'agy-gemini'} poolKey
 */
function readPoolExhaustionState(filename, poolKey) {
  const nowMs = Date.now();
  const sim = simulatedExhaustion[poolKey];
  if (sim && sim.untilMs > nowMs) {
    const remainingSeconds = Math.max(0, Math.ceil((sim.untilMs - nowMs) / 1000));
    return {
      exhausted: true,
      remaining_seconds: remainingSeconds,
      cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
      exit_code: sim.exitCode || 10,
      reason: sim.reason || "Exit code 10 (Quota Exhausted)",
      cascaded_to: sim.cascadedTo || null,
      source: "simulation",
      exhausted_at: new Date(sim.untilMs - COOLDOWN_WINDOW_SECONDS * 1000).toISOString(),
    };
  }

  const cacheDir = getCascadeCacheDir();
  const filePath = path.join(cacheDir, filename);
  try {
    if (!fs.existsSync(filePath)) {
      return {
        exhausted: false,
        remaining_seconds: 0,
        cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
        exit_code: 0,
        reason: null,
        cascaded_to: null,
        source: "cache",
        exhausted_at: null,
      };
    }
    const stat = fs.statSync(filePath);
    const elapsedSeconds = Math.floor((nowMs - stat.mtimeMs) / 1000);
    const remainingSeconds = Math.max(0, COOLDOWN_WINDOW_SECONDS - elapsedSeconds);
    if (remainingSeconds <= 0) {
      return {
        exhausted: false,
        remaining_seconds: 0,
        cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
        exit_code: 0,
        reason: null,
        cascaded_to: null,
        source: "cache",
        exhausted_at: null,
      };
    }
    return {
      exhausted: true,
      remaining_seconds: remainingSeconds,
      cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
      exit_code: 10,
      reason: `${filename} active (Exit code 10)`,
      cascaded_to: poolKey === "agy-claude" ? "agy-gemini" : "claude-direct",
      source: "cache",
      exhausted_at: new Date(stat.mtimeMs).toISOString(),
    };
  } catch {
    return {
      exhausted: false,
      remaining_seconds: 0,
      cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
      exit_code: 0,
      reason: null,
      cascaded_to: null,
      source: "cache",
      exhausted_at: null,
    };
  }
}

/**
 * Aggregate offloaded token savings across agents stored in SQLite + live memory.
 */
function computeAggregateDigestMetrics(db) {
  let dbSavedTokens = 0;
  let dbDigestCount = 0;
  let dbGitCheckpoints = 0;

  if (db) {
    try {
      const rows = db
        .prepare("SELECT metadata FROM agents WHERE metadata IS NOT NULL AND metadata != '{}'")
        .all();
      for (const row of rows) {
        try {
          const meta = JSON.parse(row.metadata);
          if (meta && Number(meta.offloaded_tokens_saved) > 0) {
            dbSavedTokens += Number(meta.offloaded_tokens_saved);
            dbDigestCount += 1;
          } else if (meta && meta.digest) {
            dbDigestCount += 1;
          }
          if (meta && Number(meta.git_checkpoints) > 0) {
            dbGitCheckpoints += Number(meta.git_checkpoints);
          }
        } catch {
          // ignore malformed metadata row
        }
      }
    } catch {
      // ignore DB query errors during early init
    }
  }

  return {
    offloaded_tokens_saved: Math.max(digestStats.offloadedTokensSaved, dbSavedTokens),
    digest_count: Math.max(digestStats.digestCount, dbDigestCount),
    git_checkpoints_total: dbGitCheckpoints,
    last_digest_at: digestStats.lastDigestAt,
    last_digest_preview: digestStats.lastDigestPreview,
  };
}

/**
 * Compute full 3-Pool Waterfall Status payload for `/api/cascade/status` and WebSockets.
 */
function getCascadeStatus(db = registeredDb) {
  const models = readCascadeModelsList();
  const pool1State = readPoolExhaustionState("claude.exhausted", "agy-claude");
  const pool2State = readPoolExhaustionState("gemini.exhausted", "agy-gemini");

  let activePool = "agy-claude";
  if (pool1State.exhausted && !pool2State.exhausted) {
    activePool = "agy-gemini";
  } else if (pool1State.exhausted && pool2State.exhausted) {
    activePool = "claude-direct";
  } else if (digestStats.activePool) {
    activePool = digestStats.activePool;
  }

  const activeModelObj = models.find((m) => m.pool === activePool) ||
    models[0] || {
      pool: activePool,
      model: "claude-opus-5-5-high",
      label: "Opus 5.5 High",
    };

  const digestMetrics = computeAggregateDigestMetrics(db);

  const pool1Obj = {
    id: "agy-claude",
    pool: "agy-claude",
    label: "Pool 1: AGY-Claude",
    short_chain: "Opus 5.5 / Sonnet 5.5 / GPT-OSS 120B",
    status: pool1State.exhausted ? "exhausted" : activePool === "agy-claude" ? "active" : "standby",
    ...pool1State,
  };
  const pool2Obj = {
    id: "agy-gemini",
    pool: "agy-gemini",
    label: "Pool 2: AGY-Gemini",
    short_chain: "Argon 4 / Gemini Pro / 3.8 Flash",
    status: pool2State.exhausted ? "exhausted" : activePool === "agy-gemini" ? "active" : "standby",
    ...pool2State,
  };
  const pool3Obj = {
    id: "claude-direct",
    pool: "claude-direct",
    label: "Pool 3: Claude Direct",
    short_chain: "Opus 4.6 / Sonnet 4.6 / Haiku 4.5",
    status: activePool === "claude-direct" ? "active" : "conductor",
    exhausted: false,
    remaining_seconds: 0,
    cooldown_total_seconds: COOLDOWN_WINDOW_SECONDS,
    exit_code: 0,
    reason: null,
    cascaded_to: null,
    source: "direct",
    exhausted_at: null,
  };

  return {
    cache_dir: getCascadeCacheDir(),
    cooldown_seconds: COOLDOWN_WINDOW_SECONDS,
    active_pool: activePool,
    active_pool_id: activePool,
    active_model: digestStats.activeModel || activeModelObj.model,
    active_model_label: activeModelObj.label,
    models,
    pools: {
      "agy-claude": pool1Obj,
      "agy-gemini": pool2Obj,
      "claude-direct": pool3Obj,
      claude: pool1Obj,
      gemini: pool2Obj,
      claude_direct: pool3Obj,
    },
    digest: digestMetrics,
    tokens_offloaded: digestMetrics.offloaded_tokens_saved,
    digest_count: digestMetrics.digest_count,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Trigger or update simulated pool exhaustion (used by the 25-second `agy-cascade` swarm simulator).
 * @param {'agy-claude' | 'agy-gemini' | 'claude' | 'gemini'} pool
 * @param {number} [cooldownSeconds]
 * @param {{ reason?: string, cascadedTo?: string, activeModel?: string }} [options]
 */
function triggerSimulatedExhaustion(pool, cooldownSeconds = COOLDOWN_WINDOW_SECONDS, options = {}) {
  const poolKey = pool === "claude" ? "agy-claude" : pool === "gemini" ? "agy-gemini" : pool;
  if (!simulatedExhaustion[poolKey]) return null;
  simulatedExhaustion[poolKey] = {
    untilMs: Date.now() + Number(cooldownSeconds || COOLDOWN_WINDOW_SECONDS) * 1000,
    exitCode: 10,
    reason:
      options.reason ||
      `Exit Code 10 (${poolKey === "agy-claude" ? "claude.exhausted" : "gemini.exhausted"})`,
    cascadedTo: options.cascadedTo || (poolKey === "agy-claude" ? "agy-gemini" : "claude-direct"),
  };
  if (options.cascadedTo) {
    digestStats.activePool = options.cascadedTo;
  }
  if (options.activeModel) {
    digestStats.activeModel = options.activeModel;
  }
  const status = getCascadeStatus();
  if (typeof registeredBroadcast === "function") {
    registeredBroadcast("cascade:status", status);
  }
  return status;
}

/**
 * Clear simulated pool exhaustion state.
 */
function clearSimulatedExhaustion() {
  simulatedExhaustion["agy-claude"] = { untilMs: 0, exitCode: 10, reason: null, cascadedTo: null };
  simulatedExhaustion["agy-gemini"] = { untilMs: 0, exitCode: 10, reason: null, cascadedTo: null };
  digestStats.activePool = "agy-claude";
  digestStats.activeModel = null;
  const status = getCascadeStatus();
  if (typeof registeredBroadcast === "function") {
    registeredBroadcast("cascade:status", status);
  }
  return status;
}

/**
 * Record an offloaded `===DIGEST===` execution summary and broadcast updated cascade metrics.
 * @param {{ savedTokens?: number, digestText?: string, activeModel?: string, activePool?: string }} payload
 */
function recordOffloadedDigest(payload = {}) {
  const saved = Math.max(0, Number(payload.savedTokens || 0));
  if (saved > 0) {
    digestStats.offloadedTokensSaved += saved;
    digestStats.digestCount += 1;
    digestStats.lastDigestAt = new Date().toISOString();
  }
  if (payload.digestText) {
    digestStats.lastDigestPreview = String(payload.digestText).slice(0, 400);
  }
  if (payload.activeModel) {
    digestStats.activeModel = payload.activeModel;
  }
  if (payload.activePool) {
    digestStats.activePool = payload.activePool;
  }
  const status = getCascadeStatus();
  if (typeof registeredBroadcast === "function") {
    registeredBroadcast("cascade:status", status);
  }
  return status;
}

/**
 * Start background watcher for `~/.cache/agy-cascade`.
 */
function startCascadeCacheWatcher({ db, broadcast, intervalMs = 5000 } = {}) {
  registeredDb = db || registeredDb;
  registeredBroadcast = broadcast || registeredBroadcast;

  if (process.env.DASHBOARD_DB_PATH && process.env.AGY_CASCADE_WATCHER_FORCE !== "1") {
    return { stop: () => {} };
  }

  if (watcherInterval) {
    clearInterval(watcherInterval);
  }

  watcherInterval = setInterval(() => {
    try {
      const status = getCascadeStatus(registeredDb);
      const signature = JSON.stringify({
        active_pool: status.active_pool,
        p1_ex: status.pools["agy-claude"].exhausted,
        p1_rem: Math.floor(status.pools["agy-claude"].remaining_seconds / 5),
        p2_ex: status.pools["agy-gemini"].exhausted,
        p2_rem: Math.floor(status.pools["agy-gemini"].remaining_seconds / 5),
        saved: status.digest.offloaded_tokens_saved,
      });
      if (signature !== lastBroadcastSignature) {
        lastBroadcastSignature = signature;
        if (typeof registeredBroadcast === "function") {
          registeredBroadcast("cascade:status", status);
        }
      }
    } catch {
      // non-blocking watcher tick
    }
  }, intervalMs);

  if (watcherInterval && typeof watcherInterval.unref === "function") {
    watcherInterval.unref();
  }

  return {
    stop: () => {
      if (watcherInterval) {
        clearInterval(watcherInterval);
        watcherInterval = null;
      }
    },
  };
}

module.exports = {
  COOLDOWN_WINDOW_SECONDS,
  getCascadeCacheDir,
  readCascadeModelsList,
  getCascadeStatus,
  triggerSimulatedExhaustion,
  clearSimulatedExhaustion,
  recordOffloadedDigest,
  startCascadeCacheWatcher,
};
