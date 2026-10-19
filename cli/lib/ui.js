/**
 * @file Presentation layer for the ccam CLI: ANSI palette, status/event
 * theming, box-drawn tables, key/value cards, inline bar charts, sparklines,
 * a generic tree renderer for arbitrary JSON, and the value formatters every
 * command shares.
 *
 * Styling follows the informal CLI conventions: colors are enabled on a TTY,
 * disabled when output is piped or redirected, force-disabled by NO_COLOR
 * (https://no-color.org), a --no-color flag anywhere on the command line, or
 * JSON output mode, and force-enabled by FORCE_COLOR / CCAM_COLOR=1. Every
 * helper degrades to plain text, so piped output stays grep/script-friendly
 * byte-for-byte and machine consumers never see escape codes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const argv = process.argv.slice(2);

/** JSON mode is decided up front (flag or env) so color can be forced off
 *  before any command renders — JSON consumers must never see ANSI codes. */
const jsonRequested =
  argv.includes("--json") ||
  /^json$/i.test(String(process.env.CCAM_OUTPUT || "")) ||
  argv.some((a, i) => a === "--format" && /^json$/i.test(argv[i + 1] || "")) ||
  argv.some((a) => /^--format=json$/i.test(a));

const useColor = (() => {
  if (process.env.NO_COLOR || argv.includes("--no-color")) return false;
  if (jsonRequested) return false;
  const force = process.env.FORCE_COLOR;
  if (force != null && force !== "" && force !== "0" && force !== "false") return true;
  if (process.env.CCAM_COLOR === "1") return true;
  return Boolean(process.stdout.isTTY);
})();

/** Build a style function from SGR open/close codes (close restores state so
 *  styles nest — e.g. bold inside a colored string). */
const sgr = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
const c = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  italic: sgr(3, 23),
  underline: sgr(4, 24),
  inverse: sgr(7, 27),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  blue: sgr(34, 39),
  magenta: sgr(35, 39),
  cyan: sgr(36, 39),
  gray: sgr(90, 39),
};

/** Per-status icon + color, shared by every table, lane, and detail view. */
const STATUS_THEME = {
  active: { icon: "●", paint: c.green },
  working: { icon: "◐", paint: c.green },
  waiting: { icon: "○", paint: c.yellow },
  completed: { icon: "OK", paint: c.gray },
  error: { icon: "ERR", paint: c.red },
  failed: { icon: "ERR", paint: c.red },
  abandoned: { icon: "◦", paint: c.gray },
  connected: { icon: "●", paint: c.green },
  idle: { icon: "·", paint: c.gray },
  running: { icon: "●", paint: c.green },
  spawning: { icon: "◌", paint: c.cyan },
  syncing: { icon: "◐", paint: c.cyan },
  ok: { icon: "OK", paint: c.green },
  killed: { icon: "■", paint: c.gray },
  exited: { icon: "OK", paint: c.gray },
};

function colorStatus(s) {
  const t = STATUS_THEME[s];
  return t ? t.paint(`${t.icon} ${s}`) : s || "-";
}

/** Hook/event types get stable colors so the feed is scannable at a glance. */
const EVENT_COLOR = {
  SessionStart: c.green,
  SessionEnd: c.gray,
  Stop: c.magenta,
  SubagentStop: c.magenta,
  PreToolUse: c.cyan,
  PostToolUse: c.blue,
  UserPromptSubmit: c.yellow,
  Notification: c.yellow,
  PreCompact: c.gray,
};
const paintEvent = (t) => (EVENT_COLOR[t] || c.cyan)(t);

const stripAnsi = (s) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "");

/** Usable terminal width, with a sane default when not a TTY (pipes, tests). */
function termWidth() {
  const w = process.stdout.columns;
  return Number.isFinite(w) && w > 40 ? w : 120;
}

/** Section heading: a colored sidebar glyph + bold title + dim subtitle. */
function heading(title, sub) {
  console.log(c.cyan("▍") + c.bold(title) + (sub ? c.dim(` — ${sub}`) : ""));
}

/** Sub-section heading used inside detail views. */
function subheading(title, sub) {
  console.log(`\n${c.cyan("▍")}${c.bold(title)}${sub ? ` ${c.dim(sub)}` : ""}`);
}

/** Aligned key/value line used by detail views. */
function kvLine(key, value, keyWidth = 9) {
  console.log(`  ${c.dim(String(key).padEnd(keyWidth))} ${value}`);
}

/** Print a key/value card with keys padded to the widest one. */
function kvCard(pairs) {
  const rows = pairs.filter(Boolean);
  const w = Math.max(...rows.map(([k]) => String(k).length), 1);
  for (const [k, v] of rows) kvLine(k, v ?? "-", w);
}

/** Horizontal bar for inline charts: value scaled against max. */
function bar(value, max, width = 16, paint = c.cyan) {
  const v = Number(value) || 0;
  // Scale against the real maximum (fractional values such as dollar costs
  // must fill the bar too); only a zero/invalid max falls back to 1.
  const m = Number(max) > 0 ? Number(max) : 1;
  // Any non-zero value renders at least one block so small counts stay visible
  // next to a dominant maximum.
  let filled = Math.min(width, Math.round((v / m) * width));
  if (v > 0 && filled === 0) filled = 1;
  return paint("█".repeat(Math.max(0, filled))) + c.dim("░".repeat(Math.max(0, width - filled)));
}

/** Labeled bar chart: one `label  ███░░ value` row per item. */
function barChart(items, { paint = c.cyan, width = 16, format = (v) => String(v) } = {}) {
  if (!items.length) return;
  const max = Math.max(...items.map(([, v]) => Number(v) || 0));
  const w = Math.max(...items.map(([k]) => stripAnsi(k).length));
  for (const [label, value] of items) {
    const pad = " ".repeat(Math.max(0, w - stripAnsi(label).length));
    console.log(`  ${label}${pad}  ${bar(value, max, width, paint)} ${c.bold(format(value))}`);
  }
}

const SPARK = "▁▂▃▄▅▆▇█";
/** Unicode sparkline for a numeric series (e.g. daily events). */
function sparkline(values) {
  const nums = values.map((v) => Number(v) || 0);
  if (!nums.length) return "";
  const max = Math.max(...nums);
  if (max <= 0) return c.dim(SPARK[0].repeat(nums.length));
  return c.cyan(
    nums.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))] || SPARK[0]).join("")
  );
}

/**
 * Render rows as a box-drawn table: bold headers, dim borders, right-aligned
 * numeric columns, and width fitting — when the natural table is wider than
 * the terminal, the widest column is progressively narrowed and its cells
 * clipped with an ellipsis, so the frame never wraps mid-row.
 */
function table(headers, rows) {
  const cells = rows.map((r) => r.map((x) => String(x ?? "")));
  // A column is numeric (→ right-aligned) when every non-empty cell looks
  // like a number, money amount, token count, or percentage.
  const numeric = headers.map(
    (_, i) =>
      cells.length > 0 &&
      cells.every((r) => {
        const v = stripAnsi(r[i]).trim();
        return v === "" || v === "-" || /^\$?[\d,.]+[%kMB]?$/.test(v);
      })
  );
  const widths = headers.map((h, i) =>
    Math.max(stripAnsi(h).length, ...cells.map((r) => stripAnsi(r[i]).length), 1)
  );
  const frameWidth = () => widths.reduce((a, w) => a + w + 3, 1);
  while (frameWidth() > termWidth() && Math.max(...widths) > 8) {
    widths[widths.indexOf(Math.max(...widths))]--;
  }
  // Clipping drops per-cell styling for simplicity — a truncated cell is
  // plain text with a trailing ellipsis.
  const clip = (s, w) => {
    const plain = stripAnsi(s);
    return plain.length <= w ? s : `${plain.slice(0, Math.max(0, w - 1))}…`;
  };
  const pad = (s, w, right) => {
    const v = clip(s, w);
    const gap = " ".repeat(Math.max(0, w - stripAnsi(v).length));
    return right ? gap + v : v + gap;
  };
  const rule = (l, m, r) => c.dim(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r);
  const line = (cols, styleFn) =>
    c.dim("│") +
    cols
      .map(
        (cell, i) =>
          ` ${styleFn ? styleFn(pad(cell, widths[i], numeric[i])) : pad(cell, widths[i], numeric[i])} `
      )
      .join(c.dim("│")) +
    c.dim("│");
  console.log(rule("╭", "┬", "╮"));
  console.log(line(headers, c.bold));
  console.log(rule("├", "┼", "┤"));
  for (const r of cells) console.log(line(r));
  if (!cells.length) {
    const inner = widths.reduce((a, w) => a + w + 2, 0) + widths.length - 1;
    console.log(c.dim("│") + c.dim(pad("  (no rows)", inner)) + c.dim("│"));
  }
  console.log(rule("╰", "┴", "╯"));
}

/**
 * Generic human rendering of arbitrary JSON — used by `--format pretty` on
 * commands whose natural output is a raw API payload. Objects become aligned
 * key/value lines, arrays of flat objects become tables, nested structures
 * indent under a dim tree rail.
 */
function renderTree(value, indent = "") {
  const isFlat = (o) =>
    o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every((v) => !isObj(v));
  const isObj = (v) => v !== null && typeof v === "object";
  const scalar = (v) => {
    if (v === null || v === undefined) return c.dim("—");
    if (typeof v === "boolean") return v ? c.green("yes") : c.dim("no");
    if (typeof v === "number") return c.cyan(String(v));
    const s = String(v);
    return s.length > 200 ? `${s.slice(0, 199)}…` : s;
  };
  if (!isObj(value)) {
    console.log(indent + scalar(value));
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      console.log(`${indent}${c.dim("(empty)")}`);
      return;
    }
    if (value.every(isFlat) && indent.length < 8) {
      const keys = [...new Set(value.flatMap((o) => Object.keys(o)))].slice(0, 8);
      table(
        keys,
        value.map((o) => keys.map((k) => stripAnsi(scalar(o[k]))))
      );
      return;
    }
    value.forEach((v, i) => {
      if (isObj(v)) {
        console.log(`${indent}${c.dim(`[${i}]`)}`);
        renderTree(v, `${indent}  `);
      } else console.log(`${indent}${c.dim("•")} ${scalar(v)}`);
    });
    return;
  }
  const keys = Object.keys(value);
  const w = Math.min(28, Math.max(...keys.map((k) => k.length), 1));
  for (const k of keys) {
    const v = value[k];
    if (isObj(v) && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
      console.log(`${indent}${c.bold(k)}`);
      renderTree(v, `${indent}  `);
    } else {
      console.log(`${indent}${c.dim(k.padEnd(w))}  ${isObj(v) ? c.dim("(empty)") : scalar(v)}`);
    }
  }
}

/** Machine output: stable, pretty-printed JSON on stdout. */
function printJson(data) {
  console.log(JSON.stringify(data === undefined ? null : data, null, 2));
}

/** Status-line helpers so success/warning glyphs are consistent. */
const ok = (msg) => console.log(`${c.green("OK")} ${msg}`);
const warn = (msg) => console.log(`${c.yellow("WARN")} ${msg}`);
const note = (msg) => console.log(c.dim(msg));

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtDuration(startIso, endIso) {
  if (!startIso) return "-";
  const ms = (endIso ? new Date(endIso) : new Date()) - new Date(startIso);
  return fmtMs(ms);
}

/** Humanize a millisecond span as 12s / 4m / 2h5m / 3d4h. */
function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.floor(ms / 1000)}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

const fmtTime = (iso) => {
  if (iso == null || iso === "") return "-";
  if (typeof iso === "number") return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  return String(iso).replace("T", " ").slice(0, 19);
};

/** Compact relative timestamp ("4m ago") for freshness-at-a-glance columns. */
function fmtAgo(iso) {
  if (!iso) return "-";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "-";
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const fmtModel = (m) => (m ? m.replace(/^claude-/, "").slice(0, 22) : "-");
const fmtCost = (n) => `$${Number(n ?? 0).toFixed(4)}`;
const fmtTokens = (n) => {
  const v = Number(n ?? 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
};
const fmtBytes = (n) => {
  const v = Number(n ?? 0);
  if (v >= 1073741824) return `${(v / 1073741824).toFixed(1)} GB`;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
};
const short = (id, n = 8) => (id ? String(id).slice(0, n) : "-");
const trunc = (s, n) => {
  const v = String(s ?? "").replace(/\s+/g, " ");
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
const onOff = (b) => (b ? c.green("on") : c.dim("off"));

module.exports = {
  useColor,
  jsonRequested,
  c,
  STATUS_THEME,
  colorStatus,
  paintEvent,
  stripAnsi,
  termWidth,
  heading,
  subheading,
  kvLine,
  kvCard,
  bar,
  barChart,
  sparkline,
  table,
  renderTree,
  printJson,
  ok,
  warn,
  note,
  fmtDuration,
  fmtMs,
  fmtTime,
  fmtAgo,
  fmtModel,
  fmtCost,
  fmtTokens,
  fmtBytes,
  short,
  trunc,
  onOff,
};
