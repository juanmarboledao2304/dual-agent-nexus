/**
 * @file Webhook provider registry. Each provider is described declaratively —
 * its display label, "family" (which determines optional HMAC/custom-header
 * support), the credential fields it needs, how its outbound URL is resolved,
 * any auth headers, and a payload formatter that turns a fired alert into that
 * provider's native request body. server/lib/webhooks.js consumes this registry
 * to build and deliver requests; routes/webhooks.js uses it for validation and
 * for the redacted provider metadata exposed to the UI.
 *
 * Adding a provider = one entry here (+ a formatter). No delivery/route changes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

// ── Shared helpers ──────────────────────────────────────────────────────────

function truncate(value, max) {
  const s = String(value == null ? "" : value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function escHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseDetails(alert) {
  if (alert.details == null) return null;
  if (typeof alert.details === "object") return alert.details;
  try {
    return JSON.parse(alert.details);
  } catch {
    return alert.details;
  }
}

// [{ title, value, short }] for the chat platforms that use Slack-style
// attachment fields (Slack legacy, Mattermost, Rocket.Chat).
function attachmentFields(alert) {
  const fields = [{ title: "Type", value: alert.rule_type, short: true }];
  if (alert.session_id)
    fields.push({ title: "Session", value: truncate(alert.session_id, 120), short: true });
  if (alert.agent_id)
    fields.push({ title: "Agent", value: truncate(alert.agent_id, 120), short: true });
  return fields;
}

const ACCENT_HEX = "#EF4444";
const ACCENT_INT = 0xef4444;

// ── Formatters ──────────────────────────────────────────────────────────────

// Slack incoming webhook — Block Kit. `text` is the required fallback string.
function formatSlack(alert) {
  const ctx = [`Type: \`${alert.rule_type}\``];
  if (alert.session_id) ctx.push(`Session: \`${truncate(alert.session_id, 64)}\``);
  if (alert.agent_id) ctx.push(`Agent: \`${truncate(alert.agent_id, 64)}\``);
  ctx.push(alert.triggered_at);
  return {
    text: truncate(`[ALERT] ${alert.rule_name}: ${alert.message}`, 3000),
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: truncate(`[ALERT] ${alert.rule_name}`, 150),
          emoji: true,
        },
      },
      { type: "section", text: { type: "mrkdwn", text: truncate(alert.message, 2900) } },
      { type: "context", elements: [{ type: "mrkdwn", text: truncate(ctx.join("  •  "), 1900) }] },
    ],
  };
}

// Discord webhook — a single rich embed.
function formatDiscord(alert) {
  const fields = [{ name: "Type", value: truncate(alert.rule_type, 1024), inline: true }];
  if (alert.session_id)
    fields.push({ name: "Session", value: truncate(alert.session_id, 1024), inline: true });
  if (alert.agent_id)
    fields.push({ name: "Agent", value: truncate(alert.agent_id, 1024), inline: true });
  return {
    username: "DualAgent Nexus",
    embeds: [
      {
        title: truncate(`[ALERT] ${alert.rule_name}`, 256),
        description: truncate(alert.message, 4000),
        color: ACCENT_INT,
        fields,
        footer: { text: "DualAgent Nexus" },
        timestamp: alert.triggered_at,
      },
    ],
  };
}

// Microsoft Teams — Adaptive Card delivered via a Power Automate "Workflows"
// webhook. The legacy O365 Connector + MessageCard transport was retired
// (connectors progressively disabled May 18–22 2026), so the target URL is a
// Workflows "When a Teams webhook request is received" URL and the body is the
// {type:"message", attachments:[adaptive card]} envelope that flow expects.
function formatTeams(alert) {
  const facts = [{ title: "Type", value: alert.rule_type }];
  if (alert.session_id) facts.push({ title: "Session", value: truncate(alert.session_id, 256) });
  if (alert.agent_id) facts.push({ title: "Agent", value: truncate(alert.agent_id, 256) });
  facts.push({ title: "Triggered", value: alert.triggered_at });
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              size: "Large",
              weight: "Bolder",
              color: "Attention",
              text: truncate(`[ALERT] ${alert.rule_name}`, 500),
              wrap: true,
            },
            { type: "TextBlock", text: truncate(alert.message, 4000), wrap: true },
            { type: "FactSet", facts },
          ],
        },
      },
    ],
  };
}

// Google Chat incoming webhook — simple text message with basic markdown
// (*bold*, `code`). Reliable across spaces without card-schema pitfalls.
function formatGoogleChat(alert) {
  const lines = [`[ALERT] *${alert.rule_name}*`, alert.message, ""];
  const meta = [`\`${alert.rule_type}\``];
  if (alert.session_id) meta.push(`session \`${truncate(alert.session_id, 64)}\``);
  if (alert.agent_id) meta.push(`agent \`${truncate(alert.agent_id, 64)}\``);
  lines.push(meta.join(" · "));
  return { text: truncate(lines.join("\n"), 4000) };
}

// Mattermost incoming webhook — Slack-compatible (legacy attachments).
function formatMattermost(alert) {
  return {
    username: "DualAgent Nexus",
    text: `[ALERT] **${alert.rule_name}**`,
    attachments: [
      {
        fallback: truncate(`${alert.rule_name}: ${alert.message}`, 1000),
        color: ACCENT_HEX,
        text: truncate(alert.message, 3000),
        fields: attachmentFields(alert),
        footer: "DualAgent Nexus",
      },
    ],
  };
}

// Rocket.Chat incoming webhook — text + Slack-style attachments.
function formatRocketChat(alert) {
  return {
    alias: "DualAgent Nexus",
    text: `[ALERT] *${alert.rule_name}*`,
    attachments: [
      {
        title: truncate(alert.rule_name, 256),
        text: truncate(alert.message, 3000),
        color: ACCENT_HEX,
        fields: attachmentFields(alert),
      },
    ],
  };
}

// Telegram Bot API sendMessage. chat_id comes from config; the bot token is in
// the resolved URL. HTML parse mode, so message text is HTML-escaped.
function formatTelegram(alert, config) {
  const lines = [`[ALERT] <b>${escHtml(alert.rule_name)}</b>`, escHtml(alert.message)];
  const meta = [`<code>${escHtml(alert.rule_type)}</code>`];
  if (alert.session_id)
    meta.push(`session <code>${escHtml(truncate(alert.session_id, 64))}</code>`);
  lines.push("", meta.join(" · "));
  return {
    chat_id: config.chat_id,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text: truncate(lines.join("\n"), 4096),
  };
}

// PagerDuty Events API v2 (trigger). routing_key + severity from config.
// dedup_key groups repeat firings of the same rule+session into one incident.
function formatPagerDuty(alert, config) {
  return {
    routing_key: config.routing_key,
    event_action: "trigger",
    dedup_key: `ccam:${alert.rule_id || "test"}:${alert.session_id || ""}`,
    payload: {
      summary: truncate(`${alert.rule_name}: ${alert.message}`, 1024),
      source: alert.session_id || "claude-code-agent-monitor",
      severity: config.severity || "warning",
      custom_details: {
        rule_name: alert.rule_name,
        rule_type: alert.rule_type,
        session_id: alert.session_id || null,
        agent_id: alert.agent_id || null,
        message: alert.message,
        details: parseDetails(alert),
        triggered_at: alert.triggered_at,
      },
    },
  };
}

// Opsgenie Alert API. api_key is sent as the GenieKey auth header (see
// authFrom), not in the body. alias dedups; region selects the host.
function formatOpsgenie(alert) {
  return {
    message: truncate(`${alert.rule_name}: ${alert.message}`, 130),
    alias: `ccam:${alert.rule_id || "test"}:${alert.session_id || ""}`,
    description: truncate(alert.message, 15000),
    source: "claude-code-agent-monitor",
    tags: ["claude-code", alert.rule_type].filter(Boolean),
    details: {
      rule_name: String(alert.rule_name),
      rule_type: String(alert.rule_type),
      session_id: alert.session_id ? String(alert.session_id) : "",
      agent_id: alert.agent_id ? String(alert.agent_id) : "",
      triggered_at: String(alert.triggered_at),
    },
  };
}

// Splunk On-Call (VictorOps) generic REST endpoint. The API + routing key live
// in the user-pasted URL; severity maps to message_type.
function formatSplunkOnCall(alert, config) {
  return {
    message_type: config.severity || "WARNING",
    entity_id: `ccam:${alert.rule_id || "test"}:${alert.session_id || ""}`,
    entity_display_name: truncate(alert.rule_name, 256),
    state_message: truncate(
      `${alert.message}\n\ntype: ${alert.rule_type}${alert.session_id ? `\nsession: ${alert.session_id}` : ""}`,
      20000
    ),
    monitoring_tool: "claude-code-agent-monitor",
  };
}

// Generic / automation platforms (Zapier, Make, n8n, Pipedream) — a clean,
// stable JSON envelope. Optional HMAC signing + custom headers handled by the
// caller (server/lib/webhooks.js) for the whole generic family.
function formatGeneric(alert) {
  return {
    event: "alert.triggered",
    source: "claude-code-agent-monitor",
    sent_at: new Date().toISOString(),
    alert: {
      id: alert.id ?? null,
      rule_id: alert.rule_id ?? null,
      rule_name: alert.rule_name,
      rule_type: alert.rule_type,
      session_id: alert.session_id ?? null,
      agent_id: alert.agent_id ?? null,
      message: alert.message,
      details: parseDetails(alert),
      triggered_at: alert.triggered_at,
    },
  };
}

// ── Registry ────────────────────────────────────────────────────────────────
//
// family:
//   "chat"    — incoming-webhook chat platforms (no extra auth, https URL)
//   "api"     — alert/event APIs with credentials and/or derived URLs
//   "generic" — arbitrary-JSON endpoints; support optional HMAC + custom headers
//
// needsUrl    — the user must supply the outbound URL
// https       — enforce https on a user-supplied URL (false allows http for local)
// defaultUrl  — fallback URL when the user supplies none
// urlFrom(cfg)— derive the URL from config (user supplies no URL)
// authFrom(cfg)— derive auth request headers from config
// fields      — provider config fields (rendered by the UI, validated server-side)

const PROVIDERS = {
  slack: { label: "Slack", family: "chat", needsUrl: true, https: true, format: formatSlack },
  discord: { label: "Discord", family: "chat", needsUrl: true, https: true, format: formatDiscord },
  teams: {
    label: "Microsoft Teams",
    family: "chat",
    needsUrl: true,
    https: true,
    urlHint:
      "Power Automate Workflows URL (Teams → Workflows → 'Post to a channel when a webhook request is received')",
    format: formatTeams,
  },
  google_chat: {
    label: "Google Chat",
    family: "chat",
    needsUrl: true,
    https: true,
    format: formatGoogleChat,
  },
  mattermost: {
    label: "Mattermost",
    family: "chat",
    needsUrl: true,
    https: true,
    format: formatMattermost,
  },
  rocketchat: {
    label: "Rocket.Chat",
    family: "chat",
    needsUrl: true,
    https: true,
    format: formatRocketChat,
  },

  telegram: {
    label: "Telegram",
    family: "api",
    https: true,
    fields: [
      { key: "bot_token", label: "Bot token", secret: true, required: true },
      { key: "chat_id", label: "Chat ID", required: true },
    ],
    urlFrom: (c) => (c.bot_token ? `https://api.telegram.org/bot${c.bot_token}/sendMessage` : null),
    format: formatTelegram,
  },

  pagerduty: {
    label: "PagerDuty",
    family: "api",
    https: true,
    defaultUrl: "https://events.pagerduty.com/v2/enqueue",
    fields: [
      { key: "routing_key", label: "Integration (routing) key", secret: true, required: true },
      {
        key: "severity",
        label: "Severity",
        type: "enum",
        options: ["info", "warning", "error", "critical"],
        default: "warning",
      },
    ],
    format: formatPagerDuty,
  },

  opsgenie: {
    label: "Opsgenie",
    family: "api",
    https: true,
    fields: [
      { key: "api_key", label: "API key", secret: true, required: true },
      { key: "region", label: "Region", type: "enum", options: ["us", "eu"], default: "us" },
    ],
    urlFrom: (c) =>
      c.region === "eu"
        ? "https://api.eu.opsgenie.com/v2/alerts"
        : "https://api.opsgenie.com/v2/alerts",
    authFrom: (c) => (c.api_key ? { Authorization: `GenieKey ${c.api_key}` } : {}),
    format: formatOpsgenie,
  },

  splunk_oncall: {
    label: "Splunk On-Call",
    family: "api",
    needsUrl: true,
    https: true,
    urlHint: "VictorOps REST endpoint URL (contains your API + routing key)",
    fields: [
      {
        key: "severity",
        label: "Message type",
        type: "enum",
        options: ["CRITICAL", "WARNING", "INFO"],
        default: "WARNING",
      },
    ],
    format: formatSplunkOnCall,
    // VictorOps returns HTTP 200 even when it rejects the event — the real
    // outcome is in the body ({ result: "success" | "failure" }). Inspect it so
    // a logical failure isn't silently recorded as delivered.
    verifyResponse: (text) => {
      if (!text) return { ok: true };
      try {
        const j = JSON.parse(text);
        if (j && typeof j.result === "string" && j.result.toLowerCase() === "failure") {
          return { ok: false, error: j.message || "Splunk On-Call reported failure" };
        }
      } catch {
        /* non-JSON 200 body — trust the status */
      }
      return { ok: true };
    },
  },

  zapier: {
    label: "Zapier",
    family: "generic",
    needsUrl: true,
    https: true,
    format: formatGeneric,
  },
  make: { label: "Make", family: "generic", needsUrl: true, https: true, format: formatGeneric },
  n8n: { label: "n8n", family: "generic", needsUrl: true, https: false, format: formatGeneric },
  pipedream: {
    label: "Pipedream",
    family: "generic",
    needsUrl: true,
    https: true,
    format: formatGeneric,
  },
  generic: {
    label: "Generic (custom JSON)",
    family: "generic",
    needsUrl: true,
    https: false,
    format: formatGeneric,
  },
};

const WEBHOOK_TYPES = Object.keys(PROVIDERS);

function isGenericFamily(type) {
  return PROVIDERS[type]?.family === "generic";
}

/** Resolve the outbound URL for a target: derived → user-supplied → default. */
function resolveUrl(target) {
  const p = PROVIDERS[target.type];
  if (!p) return target.url || null;
  if (p.urlFrom) {
    const derived = p.urlFrom(target.config || {});
    if (derived) return derived;
  }
  if (target.url) return target.url;
  return p.defaultUrl || null;
}

/** Provider-derived auth headers (e.g. Opsgenie GenieKey). */
function resolveAuthHeaders(target) {
  const p = PROVIDERS[target.type];
  if (p?.authFrom) return p.authFrom(target.config || {}) || {};
  return {};
}

function formatPayload(type, alert, config = {}) {
  const p = PROVIDERS[type] || PROVIDERS.generic;
  return p.format(alert, config);
}

/** Whether a user-supplied URL is required for this provider type. */
function urlRequired(type) {
  const p = PROVIDERS[type];
  if (!p) return true;
  if (p.urlFrom || p.defaultUrl) return false;
  return !!p.needsUrl;
}

/** Redacted, serializable provider metadata for the UI/API. */
function publicProviders() {
  return WEBHOOK_TYPES.map((type) => {
    const p = PROVIDERS[type];
    return {
      type,
      label: p.label,
      family: p.family,
      url_required: urlRequired(type),
      has_default_url: !!p.defaultUrl,
      derives_url: !!p.urlFrom,
      allow_http: p.https === false,
      url_hint: p.urlHint || null,
      supports_secret: p.family === "generic",
      supports_headers: p.family === "generic",
      fields: (p.fields || []).map((f) => ({
        key: f.key,
        label: f.label,
        secret: !!f.secret,
        required: !!f.required,
        type: f.type || "string",
        options: f.options || null,
        default: f.default ?? null,
      })),
    };
  });
}

module.exports = {
  PROVIDERS,
  WEBHOOK_TYPES,
  isGenericFamily,
  resolveUrl,
  resolveAuthHeaders,
  formatPayload,
  urlRequired,
  publicProviders,
  truncate,
};
