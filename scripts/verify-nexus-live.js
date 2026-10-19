/**
 * @file verify-nexus-live.js
 * @description Automated cross-platform smoke test for DualAgent Nexus.
 * Spawns the backend server, verifies /api/cascade/status and /api/simulate/swarm,
 * and shuts down cleanly without leaving background processes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = process.env.PORT || 4820;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          // not json
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json || data });
      });
    });
    req.on("error", reject);
    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function waitForServer(maxAttempts = 15, delayMs = 600) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/cascade/status",
        method: "GET",
      });
      if (res.statusCode === 200) {
        return res.body;
      }
    } catch {
      // server still starting
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server failed to respond on ${BASE_URL} after ${maxAttempts} attempts.`);
}

async function runSmokeTest() {
  console.log(`[smoke:nexus] Spawning backend server on port ${PORT}...`);
  const serverScript = path.resolve(__dirname, "../server/index.js");
  const server = spawn(process.execPath, [serverScript], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  server.stdout.on("data", (c) => {
    serverOutput += c;
  });
  server.stderr.on("data", (c) => {
    serverOutput += c;
  });

  try {
    console.log(`[smoke:nexus] Waiting for ${BASE_URL}/api/cascade/status...`);
    const statusBody = await waitForServer();
    console.log("[smoke:nexus] GET /api/cascade/status returned 200 OK:");
    console.log(
      JSON.stringify(
        {
          active_pool: statusBody.active_pool,
          active_model: statusBody.active_model,
          pools: Object.keys(statusBody.pools || {}),
          tokens_offloaded: statusBody.tokens_offloaded,
        },
        null,
        2
      )
    );

    console.log(`[smoke:nexus] Triggering POST ${BASE_URL}/api/simulate/swarm...`);
    const swarmRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/simulate/swarm",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {}
    );

    if ((swarmRes.statusCode !== 200 && swarmRes.statusCode !== 201) || !swarmRes.body?.ok) {
      throw new Error(`Simulation request failed: status ${swarmRes.statusCode}`);
    }

    console.log(`[smoke:nexus] POST /api/simulate/swarm returned ${swarmRes.statusCode} OK:`);
    console.log(
      JSON.stringify(
        {
          ok: swarmRes.body.ok,
          simulation: swarmRes.body.simulation,
          duration_seconds: swarmRes.body.duration_seconds,
          steps: swarmRes.body.steps?.length || 0,
        },
        null,
        2
      )
    );

    console.log("[smoke:nexus] All smoke checks passed cleanly!");
  } finally {
    console.log("[smoke:nexus] Terminating smoke server cleanly...");
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    try {
      server.kill("SIGKILL");
    } catch {
      // already stopped
    }
  }
}

if (require.main === module) {
  runSmokeTest()
    .then(() => {
      console.log("[smoke:nexus] Smoke test completed with code 0.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[smoke:nexus] ERROR:", err.message);
      process.exit(1);
    });
}

module.exports = { runSmokeTest };
