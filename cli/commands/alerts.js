/**
 * @file ccam alerting commands: the fired-alert feed (list / ack / ack-all),
 * alert rules (list / types / create / update / enable / disable / delete),
 * and webhook targets (list / get / providers / deliveries / create /
 * update / enable / disable / delete / test). Rules and webhooks can be
 * written with first-class flags or a raw --data JSON body; every write is
 * gated by confirm() (--yes, or an interactive y/N on a TTY).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const { Option } = require("commander");
const {
  c,
  table,
  heading,
  subheading,
  kvCard,
  printJson,
  renderTree,
  colorStatus,
  onOff,
  fmtTime,
  fmtAgo,
  trunc,
} = require("../lib/ui");
const { isJson, isPretty, CliError } = require("../lib/runtime");
const { get, post, patch, del, qs, enc } = require("../lib/http");
const { requireDb } = require("../lib/offline");
const {
  run,
  listGroup,
  confirm,
  posIntArg,
  intArg,
  csvArg,
  kvArg,
  boolArg,
  readJsonInput,
  jsonBodyOptions,
} = require("../lib/framework");

const GROUP = "Alerts & Webhooks:";

/** Rule types and their config fields (server/lib/alerts.js validateRuleConfig). */
const RULE_TYPES = {
  event_pattern: {
    summary: "Fire when matching events occur (optionally N times within a window)",
    fields: {
      event_type: "hook event type, e.g. PostToolUse",
      tool_name: "tool name, e.g. Bash",
      summary_contains: "substring of the event summary",
      count: "occurrences needed (default 1)",
      window_minutes: "window for count > 1 (default 5)",
    },
    example: '{"tool_name":"Bash","summary_contains":"rm -rf"}',
  },
  inactivity: {
    summary: "Fire when an active session has had no events for N minutes",
    fields: { minutes: "idle minutes" },
    example: '{"minutes":30}',
  },
  status_duration: {
    summary: "Fire when an agent stays in a status for N minutes",
    fields: { status: "working | waiting | …", minutes: "minutes in that status" },
    example: '{"status":"waiting","minutes":15}',
  },
  token_threshold: {
    summary: "Fire when a session's total tokens cross a threshold",
    fields: { total_tokens: "token count" },
    example: '{"total_tokens":2000000}',
  },
};

// ── Fired alerts ────────────────────────────────────────────────────────────

function alertRow(a) {
  return [
    a.id,
    a.acknowledged_at ? c.dim("acked") : c.yellow("open"),
    fmtTime(a.triggered_at),
    (a.rule_name || "").slice(0, 24),
    (a.message || "").slice(0, 52),
  ];
}

function renderAlerts(data) {
  if (isJson()) return printJson(data);
  table(["ID", "State", "Triggered", "Rule", "Message"], (data.alerts || []).map(alertRow));
  console.log(
    c.dim(`\n${data.unacked ?? 0} unacknowledged of ${data.total ?? (data.alerts || []).length}`)
  );
}

function alertListOptions(cmd) {
  return cmd
    .option("--unacked", "only unacknowledged alerts")
    .option("--limit <n>", "rows to return", posIntArg, 20);
}

async function listAlerts({ opts }) {
  renderAlerts(
    await get(`/api/alerts${qs({ unacked: opts.unacked ? "true" : undefined, limit: opts.limit })}`)
  );
}

function offlineAlerts({ opts }) {
  const db = requireDb();
  const conds = opts.unacked ? "WHERE acknowledged_at IS NULL" : "";
  const alerts = db.all(
    `SELECT * FROM alert_events ${conds} ORDER BY triggered_at DESC LIMIT ?`,
    opts.limit ?? 20
  );
  const unacked = db.all("SELECT COUNT(*) AS n FROM alert_events WHERE acknowledged_at IS NULL")[0]
    .n;
  const total = db.all("SELECT COUNT(*) AS n FROM alert_events")[0].n;
  renderAlerts({ alerts, unacked, total });
}

// ── Rules ───────────────────────────────────────────────────────────────────

function renderRules(rules) {
  if (isJson()) return printJson({ rules });
  table(
    ["ID", "Enabled", "Type", "Name", "Cooldown"],
    rules.map((r) => [
      r.id,
      r.enabled ? c.green("on") : c.dim("off"),
      r.rule_type,
      (r.name || "").slice(0, 32),
      r.cooldown_seconds != null ? `${Math.round(r.cooldown_seconds / 60)}m` : "-",
    ])
  );
}

async function listRules() {
  renderRules((await get("/api/alerts/rules")).rules || []);
}

function offlineRules() {
  const rules = requireDb()
    .all("SELECT * FROM alert_rules ORDER BY id")
    .map((r) => ({ ...r, enabled: r.enabled === 1 || r.enabled === true }));
  renderRules(rules);
}

function ruleTypes() {
  if (isJson()) return printJson({ rule_types: RULE_TYPES });
  heading("Alert rule types", "use with: ccam alert-rules create --type <type> --config JSON");
  for (const [type, spec] of Object.entries(RULE_TYPES)) {
    console.log(`\n  ${c.cyan(c.bold(type))}  ${spec.summary}`);
    for (const [k, v] of Object.entries(spec.fields))
      console.log(`    ${c.yellow(k.padEnd(17))} ${c.dim(v)}`);
    console.log(`    ${c.dim("example:")} ${spec.example}`);
  }
}

/** Build a rule config from --config JSON or the per-field convenience flags. */
function ruleConfig(opts) {
  const fromJson = readJsonInput(opts, "config");
  const cfg = { ...(fromJson || {}) };
  if (opts.eventType) cfg.event_type = opts.eventType;
  if (opts.tool) cfg.tool_name = opts.tool;
  if (opts.contains) cfg.summary_contains = opts.contains;
  if (opts.count != null) cfg.count = opts.count;
  if (opts.window != null) cfg.window_minutes = opts.window;
  if (opts.minutes != null) cfg.minutes = opts.minutes;
  if (opts.agentStatus) cfg.status = opts.agentStatus;
  if (opts.tokens != null) cfg.total_tokens = opts.tokens;
  return Object.keys(cfg).length || fromJson ? cfg : undefined;
}

function ruleConfigOptions(cmd) {
  return cmd
    .option("--config <json>", "rule config JSON (or @file, or -) — see `ccam alert-rules types`")
    .option("--file <path>", "read the config JSON from a file")
    .option("--event-type <type>", "event_pattern: hook event type")
    .option("--tool <name>", "event_pattern: tool name")
    .option("--contains <text>", "event_pattern: summary substring")
    .option("--count <n>", "event_pattern: occurrences needed", posIntArg)
    .option("--window <minutes>", "event_pattern: window for count > 1", posIntArg)
    .option("--minutes <n>", "inactivity / status_duration: minutes", posIntArg)
    .option("--agent-status <status>", "status_duration: agent status")
    .option("--tokens <n>", "token_threshold: total tokens", posIntArg)
    .option("--cooldown <seconds>", "cooldown between firings (default 300)", intArg);
}

const RULE_REFUSAL = "Alert-rule writes require --yes.";

async function ruleCreate({ opts }) {
  if (!opts.name || !opts.type) {
    throw new CliError("create requires --name, --type, and optional --config JSON.", {
      code: "USAGE",
      hints: ["Rule types: ccam alert-rules types"],
    });
  }
  const body = {
    name: opts.name,
    rule_type: opts.type,
    config: ruleConfig(opts) || {},
    enabled: !opts.disabled,
    cooldown_seconds: opts.cooldown ?? 300,
  };
  await confirm(opts, {
    prompt: `Create alert rule "${opts.name}" (${opts.type})?`,
    refusal: RULE_REFUSAL,
  });
  const r = await post("/api/alerts/rules", body);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Created alert rule ${r.rule.id}`);
}

async function ruleUpdate({ args, opts }) {
  const body = {};
  if (opts.name !== undefined) body.name = opts.name;
  const cfg = ruleConfig(opts);
  if (cfg !== undefined) {
    // PATCH replaces the whole config, so field flags (e.g. --minutes 5)
    // merge onto the rule's current config; an explicit --config JSON is
    // taken as the complete new config.
    if (opts.config === undefined && opts.file === undefined) {
      const current = ((await get("/api/alerts/rules")).rules || []).find((r) => r.id === args[0]);
      body.config = { ...(current?.config || {}), ...cfg };
    } else body.config = cfg;
  }
  if (opts.enabled !== undefined) body.enabled = opts.enabled;
  if (opts.cooldown !== undefined) body.cooldown_seconds = opts.cooldown;
  if (!Object.keys(body).length) {
    throw new CliError(
      "Nothing to update — pass --name, --config/field flags, --enabled, or --cooldown.",
      {
        code: "USAGE",
      }
    );
  }
  await confirm(opts, { prompt: `Update alert rule ${args[0]}?`, refusal: RULE_REFUSAL });
  const r = await patch(`/api/alerts/rules/${enc(args[0])}`, body);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Updated alert rule ${args[0]}`);
}

async function ruleToggle(id, enabled, opts) {
  await confirm(opts, {
    prompt: `${enabled ? "Enable" : "Disable"} alert rule ${id}?`,
    refusal: RULE_REFUSAL,
  });
  const r = await patch(`/api/alerts/rules/${enc(id)}`, { enabled });
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} Alert rule ${id} ${enabled ? c.green("enabled") : c.dim("disabled")}`
  );
}

async function ruleDelete({ args, opts }) {
  await confirm(opts, { prompt: `Delete alert rule ${args[0]}?`, refusal: RULE_REFUSAL });
  const r = await del(`/api/alerts/rules/${enc(args[0])}`);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Deleted alert rule ${args[0]}`);
}

/** Attach the rule subcommands to a group (shared by `alert-rules` and `alerts rules`). */
function ruleSubcommands(g) {
  const ONLY = "alert-rule writes go through the server (validation + cache invalidation)";
  g.command("types").description("Rule types and their config fields").action(run(ruleTypes));
  ruleConfigOptions(
    g
      .command("create")
      .description("Create a rule (--name, --type, then --config JSON or field flags)")
      .option("--name <name>", "rule name")
      .addOption(new Option("--type <type>", "rule type").choices(Object.keys(RULE_TYPES)))
      .option("--disabled", "create it disabled")
      .option("-y, --yes", "confirm the write")
  ).action(run(ruleCreate, { serverOnly: ONLY }));
  ruleConfigOptions(
    g
      .command("update")
      .description("Update a rule (partial)")
      .argument("<id>", "alert rule id")
      .option("--name <name>", "new name")
      .option("--enabled <bool>", "true / false", boolArg)
      .option("-y, --yes", "confirm the write")
  ).action(run(ruleUpdate, { serverOnly: ONLY }));
  g.command("enable")
    .description("Enable a rule")
    .argument("<id>", "alert rule id")
    .option("-y, --yes", "confirm the write")
    .action(run(({ args, opts }) => ruleToggle(args[0], true, opts), { serverOnly: ONLY }));
  g.command("disable")
    .description("Disable a rule")
    .argument("<id>", "alert rule id")
    .option("-y, --yes", "confirm the write")
    .action(run(({ args, opts }) => ruleToggle(args[0], false, opts), { serverOnly: ONLY }));
  g.command("delete")
    .alias("rm")
    .description("Delete a rule")
    .argument("<id>", "alert rule id")
    .option("-y, --yes", "confirm the write")
    .action(run(ruleDelete, { serverOnly: ONLY }));
  return g;
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function renderWebhooks(targets) {
  if (isJson()) return printJson({ targets });
  table(
    ["ID", "Enabled", "Provider", "Name", "URL", "Last delivery"],
    targets.map((t) => [
      t.id,
      t.enabled ? c.green("on") : c.dim("off"),
      t.type,
      (t.name || "").slice(0, 28),
      t.url_preview || t.url_masked || t.url || "-",
      t.last_delivery
        ? `${colorStatus(t.last_delivery.status)} ${c.dim(fmtAgo(t.last_delivery.created_at))}`
        : c.dim("never"),
    ])
  );
}

async function listWebhooks() {
  renderWebhooks((await get("/api/webhooks")).targets || []);
}

async function showWebhook({ args }) {
  const t = ((await get("/api/webhooks")).targets || []).find(
    (x) => x.id === args[0] || x.id.startsWith(args[0])
  );
  if (!t) throw new CliError(`Webhook not found: ${args[0]}`, { code: "NOT_FOUND" });
  if (isJson()) return printJson({ target: t });
  console.log(`${c.cyan("▍")}${c.bold(t.name)} ${c.dim(`(${t.id})`)}`);
  kvCard([
    ["Provider", t.type],
    ["Enabled", onOff(t.enabled)],
    ["URL", t.url_preview || "-"],
    ["Secret", t.has_secret ? c.green("set") : c.dim("none")],
    ["Rules", t.rule_ids ? t.rule_ids.join(", ") : c.dim("all rules")],
    ["Created", fmtTime(t.created_at)],
    [
      "Last",
      t.last_delivery
        ? `${colorStatus(t.last_delivery.status)} HTTP ${t.last_delivery.status_code ?? "-"} ${c.dim(fmtTime(t.last_delivery.created_at))}`
        : c.dim("never delivered"),
    ],
  ]);
  if (t.headers && Object.keys(t.headers).length) {
    subheading("Headers");
    renderTree(t.headers, "  ");
  }
  if (t.config && Object.keys(t.config).length) {
    subheading("Config");
    renderTree(t.config, "  ");
  }
}

/** Build a webhook body from --data JSON plus convenience flags (flags win). */
function webhookBody(opts) {
  const body = { ...(readJsonInput(opts) || {}) };
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.type !== undefined) body.type = opts.type;
  if (opts.url !== undefined) body.url = opts.url;
  if (opts.secret !== undefined) body.secret = opts.secret;
  if (opts.header !== undefined) body.headers = opts.header;
  if (opts.rules !== undefined) body.rule_ids = opts.rules;
  if (opts.config !== undefined) {
    try {
      body.config = JSON.parse(opts.config);
    } catch (err) {
      throw new CliError(`Invalid JSON in --config: ${err.message}`, { code: "BAD_INPUT" });
    }
  }
  if (opts.disabled) body.enabled = false;
  if (opts.enabled !== undefined) body.enabled = opts.enabled;
  return body;
}

function webhookFieldOptions(cmd) {
  return jsonBodyOptions(cmd, "webhook")
    .option("--name <name>", "display name")
    .option("--type <provider>", "provider type (see `ccam webhooks providers`)")
    .option("--url <url>", "destination URL")
    .option("--secret <secret>", "HMAC signing secret (generic family only)")
    .option("--header <key=value>", "custom header (repeatable; generic family only)", kvArg)
    .option("--rules <ids>", "only deliver these alert rule ids (comma-separated)", csvArg)
    .option("--config <json>", "provider-specific config JSON (e.g. Telegram chat_id)")
    .option("-y, --yes", "confirm the write");
}

const WEBHOOK_REFUSAL = "Webhook writes require --yes.";

async function webhookCreate({ opts }) {
  const body = webhookBody(opts);
  if (!body.name || !body.type) {
    throw new CliError("create requires --name and --type (or both in --data JSON).", {
      code: "USAGE",
      hints: ["Providers: ccam webhooks providers --format pretty"],
    });
  }
  await confirm(opts, {
    prompt: `Create ${body.type} webhook "${body.name}"?`,
    refusal: WEBHOOK_REFUSAL,
  });
  const r = await post("/api/webhooks", body);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Created webhook ${r.target.id}`);
}

async function webhookUpdate({ args, opts }) {
  const body = webhookBody(opts);
  if (!Object.keys(body).length) {
    throw new CliError("Nothing to update — pass field flags or --data JSON.", { code: "USAGE" });
  }
  await confirm(opts, { prompt: `Update webhook ${args[0]}?`, refusal: WEBHOOK_REFUSAL });
  const r = await patch(`/api/webhooks/${enc(args[0])}`, body);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Updated webhook ${r.target.id}`);
}

async function webhookToggle(id, enabled, opts) {
  await confirm(opts, {
    prompt: `${enabled ? "Enable" : "Disable"} webhook ${id}?`,
    refusal: WEBHOOK_REFUSAL,
  });
  const r = await patch(`/api/webhooks/${enc(id)}`, { enabled });
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Webhook ${id} ${enabled ? c.green("enabled") : c.dim("disabled")}`);
}

async function webhookDelete({ args, opts }) {
  await confirm(opts, { prompt: `Delete webhook ${args[0]}?`, refusal: WEBHOOK_REFUSAL });
  const r = await del(`/api/webhooks/${enc(args[0])}`);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Deleted webhook ${args[0]}`);
}

async function webhookTest({ args }) {
  const r = await post(`/api/webhooks/${enc(args[0])}/test`);
  const okay = r.ok || r.success;
  if (!okay) process.exitCode = 1;
  if (isJson()) return printJson(r);
  console.log(
    okay
      ? `${c.green("OK")} Test delivery succeeded (HTTP ${r.status ?? "?"}, ${r.attempts ?? 1} attempt(s))`
      : `${c.red("ERR")} Test delivery failed: ${r.error || `HTTP ${r.status}`}`
  );
}

async function webhookProviders() {
  const d = await get("/api/webhooks/providers");
  if (!isPretty()) return printJson(d);
  table(
    ["Type", "Label", "URL required"],
    (d.providers || []).map((p) => [
      p.type,
      p.label || p.name || "",
      p.url_required || p.urlRequired ? "yes" : "no",
    ])
  );
}

async function webhookDeliveries({ args, opts }) {
  const d = await get(`/api/webhooks/${enc(args[0])}/deliveries?limit=${opts.limit}`);
  if (!isPretty()) return printJson(d);
  table(
    ["When", "Status", "HTTP", "Attempts", "Error"],
    (d.deliveries || []).map((x) => [
      fmtTime(x.created_at),
      colorStatus(x.status),
      x.status_code ?? "-",
      x.attempts ?? "-",
      trunc(x.error || "", 40),
    ])
  );
}

// ── Registration ────────────────────────────────────────────────────────────

function register(program) {
  const ONLY_ACK = "acknowledging alerts is a server-side mutation";
  const alerts = listGroup(program, "alerts", {
    group: GROUP,
    description: "Fired-alert feed (default: list)",
    configure: alertListOptions,
    handler: listAlerts,
    offline: offlineAlerts,
  });
  alerts
    .command("ack")
    .description("Acknowledge one alert")
    .argument("<id>", "alert id")
    .action(
      run(
        async ({ args }) => {
          const r = await post(`/api/alerts/${enc(args[0])}/ack`);
          if (isJson()) return printJson(r ?? { ok: true });
          console.log(`${c.green("OK")} Alert ${args[0]} acknowledged`);
        },
        { serverOnly: ONLY_ACK }
      )
    );
  alerts
    .command("ack-all")
    .description("Acknowledge every unacknowledged alert")
    .action(
      run(
        async () => {
          const r = await post("/api/alerts/ack-all");
          if (isJson()) return printJson(r);
          console.log(`${c.green("OK")} Acknowledged ${r?.acknowledged ?? "all"} alert(s)`);
        },
        { serverOnly: ONLY_ACK }
      )
    );
  ruleSubcommands(
    listGroup(alerts, "rules", {
      description: "Alert rules (same as `ccam alert-rules`)",
      handler: listRules,
      offline: offlineRules,
    })
  );

  program
    .command("rules")
    .helpGroup(GROUP)
    .description("List alert rules (shortcut for `alert-rules list`)")
    .action(run(listRules, { offline: offlineRules }));

  ruleSubcommands(
    listGroup(program, "alert-rules", {
      group: GROUP,
      description: "Manage alert rules: list, types, create, update, enable, disable, delete",
      handler: listRules,
      offline: offlineRules,
    })
  );

  const ONLY_WH = "webhook configuration and test deliveries are server-side";
  const webhooks = listGroup(program, "webhooks", {
    group: GROUP,
    description:
      "Manage webhook targets: list, get, create, update, test, deliveries (default: list)",
    handler: listWebhooks,
    serverOnly: ONLY_WH,
  });
  webhooks
    .command("get")
    .alias("show")
    .description("One webhook target's detail (redacted)")
    .argument("<id>", "webhook id (or unique prefix)")
    .action(run(showWebhook, { serverOnly: ONLY_WH }));
  webhooks
    .command("providers")
    .description("Supported provider catalog (raw JSON; --format pretty for a table)")
    .action(run(webhookProviders, { serverOnly: ONLY_WH }));
  webhooks
    .command("deliveries")
    .description("Delivery history for a target (raw JSON; --format pretty for a table)")
    .argument("<id>", "webhook id")
    .option("--limit <n>", "rows to return", posIntArg, 20)
    .action(run(webhookDeliveries, { serverOnly: ONLY_WH }));
  webhookFieldOptions(
    webhooks
      .command("create")
      .description("Create a target (--name --type --url …, or --data JSON)")
      .option("--disabled", "create it disabled")
  ).action(run(webhookCreate, { serverOnly: ONLY_WH }));
  webhookFieldOptions(
    webhooks
      .command("update")
      .description("Update a target (partial)")
      .argument("<id>", "webhook id")
      .option("--enabled <bool>", "true / false", boolArg)
  ).action(run(webhookUpdate, { serverOnly: ONLY_WH }));
  webhooks
    .command("enable")
    .description("Enable a target")
    .argument("<id>", "webhook id")
    .option("-y, --yes", "confirm the write")
    .action(run(({ args, opts }) => webhookToggle(args[0], true, opts), { serverOnly: ONLY_WH }));
  webhooks
    .command("disable")
    .description("Disable a target")
    .argument("<id>", "webhook id")
    .option("-y, --yes", "confirm the write")
    .action(run(({ args, opts }) => webhookToggle(args[0], false, opts), { serverOnly: ONLY_WH }));
  webhooks
    .command("delete")
    .alias("rm")
    .description("Delete a target")
    .argument("<id>", "webhook id")
    .option("-y, --yes", "confirm the write")
    .action(run(webhookDelete, { serverOnly: ONLY_WH }));
  webhooks
    .command("test")
    .description("Send a synthetic test alert to a target (exit 1 on failure)")
    .argument("<id>", "webhook id")
    .action(run(webhookTest, { serverOnly: ONLY_WH }));
}

module.exports = { register, RULE_TYPES };
