#!/usr/bin/env node
/**
 * @file Claude Code statusline that also feeds DualAgent Nexus the real subscription limits. Claude Code
 * pipes a JSON object to the statusline command; its `rate_limits` (five_hour / seven_day with
 * used_percentage and resets_at) is the only place those limits are exposed, so this script forwards it
 * to POST /api/quota/claude-limits (same transport and token as the hook handler) and prints one compact
 * line: model, context use, 5-hour use with its reset, and weekly use. It never blocks Claude Code: the
 * POST is fire-and-forget with a short timeout, and any error still prints the line.
 *
 * Install in ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "node \"<repo>/statusline/nexus-statusline.js\"" }
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const path = require("node:path");

/** Ports of the live Nexus servers (discovery file, env override, or 7770). */
function resolvePorts() {
  try {
    return require(
      path.join(__dirname, "..", "server", "lib", "server-info")
    ).resolveHookIngestPorts();
  } catch {
    const envPort = parseInt(process.env.CLAUDE_DASHBOARD_PORT || "", 10);
    return [Number.isInteger(envPort) && envPort > 0 ? envPort : 7770];
  }
}

/** "2h 05m" / "45m" until an epoch-seconds instant. */
function until(epochSeconds) {
  const mins = Math.max(0, Math.round((epochSeconds * 1000 - Date.now()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return `${h}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** The single status line Claude Code shows under the prompt. */
function renderLine(input) {
  const parts = [];
  const model = input?.model?.display_name || input?.model?.id;
  if (model) parts.push(model);
  const ctx = input?.context_window?.used_percentage;
  if (Number.isFinite(ctx)) parts.push(`ctx ${Math.round(ctx)}%`);
  const five = input?.rate_limits?.five_hour;
  if (five && Number.isFinite(five.used_percentage)) {
    parts.push(`5h ${Math.round(five.used_percentage)}% (${until(five.resets_at)})`);
  }
  const week = input?.rate_limits?.seven_day;
  if (week && Number.isFinite(week.used_percentage)) {
    parts.push(`7d ${Math.round(week.used_percentage)}%`);
  }
  return parts.join(" · ");
}

function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let input = null;
    try {
      input = JSON.parse(raw);
    } catch {
      input = null;
    }
    process.stdout.write(renderLine(input) + "\n");

    if (!input || !input.rate_limits) {
      process.exit(0);
      return;
    }
    let sendHook;
    try {
      ({ sendHook } = require(path.join(__dirname, "..", "scripts", "hook-transport")));
    } catch {
      process.exit(0);
      return;
    }
    sendHook(resolvePorts, "/api/quota/claude-limits", { rate_limits: input.rate_limits }).finally(
      () => setImmediate(() => process.exit(0))
    );
  });

  // Safety net: the statusline must never hang Claude Code.
  setTimeout(() => process.exit(0), 2500).unref();
}

if (require.main === module) main();

module.exports = { renderLine, until };
