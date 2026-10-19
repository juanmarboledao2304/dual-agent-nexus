/**
 * @file ccam data-ingestion commands: history import (guide / rescan / path /
 * upload / reimport), restoring a dashboard export (import-data), and the
 * SSH remote data sources the dashboard mirrors Claude Code and Codex
 * history from (list / add / update / enable / disable / test / sync / rm).
 * No secrets are handled here; remote auth defers to the host's SSH stack.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { Option } = require("commander");
const {
  c,
  table,
  heading,
  kvCard,
  printJson,
  renderTree,
  colorStatus,
  onOff,
  fmtAgo,
} = require("../lib/ui");
const { isJson, isPretty, CliError } = require("../lib/runtime");
const { get, post, patch, del, rawFetch, readBody, enc } = require("../lib/http");
const {
  run,
  listGroup,
  confirm,
  posIntArg,
  readJsonInput,
  jsonBodyOptions,
} = require("../lib/framework");

const IMPORT_GROUP = "Import:";
const REMOTE_GROUP = "Remote sources:";
const IMPORT_ONLY = "imports must go through the server's ingestion pipeline";

const providerOption = () =>
  new Option("--provider <provider>", "history format")
    .choices(["claude", "codex"])
    .default("claude");

function importSummary(r) {
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} imported ${r.imported ?? 0}, backfilled ${r.backfilled ?? 0}, skipped ${r.skipped ?? 0}, errors ${r.errors ?? 0}`
  );
}

async function importGuide({ opts }) {
  const d = await get(`/api/import/guide?provider=${enc(opts.provider)}`);
  if (!isPretty()) return printJson(d);
  heading("Import guide", d.provider);
  renderTree(d);
}

async function importRescan({ opts }) {
  if (!isJson()) console.log(c.dim(`Rescanning ${opts.provider} history — this can take a while…`));
  importSummary(
    await post("/api/import/rescan", { provider: opts.provider }, { timeoutMs: 600_000 })
  );
}

async function importPath({ args, opts }) {
  if (!isJson()) console.log(c.dim(`Scanning ${args[0]} …`));
  importSummary(
    await post(
      "/api/import/scan-path",
      { path: path.resolve(process.cwd(), args[0]), provider: opts.provider },
      { timeoutMs: 600_000 }
    )
  );
}

async function importUpload({ args, opts }) {
  const files = args[0].map((file) => path.resolve(process.cwd(), file));
  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new CliError(`File not found: ${file}`, { code: "NOT_FOUND" });
    }
  }
  const form = new FormData();
  form.append("provider", opts.provider);
  for (const file of files)
    form.append("files", new Blob([fs.readFileSync(file)]), path.basename(file));
  const response = await rawFetch("/api/import/upload", { method: "POST", body: form }, 600_000);
  const result = (await readBody(response)) ?? {};
  if (!response.ok) {
    const msg = typeof result === "string" ? result : result?.error?.message || response.status;
    throw new CliError(`Upload failed: ${msg}`, { code: "UPLOAD_FAILED" });
  }
  if (!isPretty()) return printJson(result);
  renderTree(result);
}

async function importReimport() {
  if (!isJson())
    console.log(
      c.dim("Re-importing local Claude Code and Cursor history — this can take a while…")
    );
  const r = await post("/api/settings/reimport", undefined, { timeoutMs: 600_000 });
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} Claude: imported ${r.imported ?? 0}, backfilled ${r.backfilled ?? 0}, skipped ${r.skipped ?? 0}` +
      (r.cursor ? c.dim(` · Cursor: ${JSON.stringify(r.cursor)}`) : "")
  );
}

// Restore a bundle produced by `ccam export` (or the dashboard's Export data).
// The local server reads the file from disk, so we pass an absolute path rather
// than uploading — idempotent and non-destructive (existing sessions skipped).
async function importData({ args }) {
  const abs = path.resolve(process.cwd(), args[0]);
  if (!fs.existsSync(abs)) throw new CliError(`File not found: ${abs}`, { code: "NOT_FOUND" });
  const r = await post("/api/settings/import", { path: abs }, { timeoutMs: 600_000 });
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} Restored: ${r.sessions_imported ?? 0} sessions added, ` +
      `${r.sessions_skipped ?? 0} already present, ${r.events ?? 0} events, ` +
      `${r.model_pricing ?? 0} pricing rules ` +
      `(${r.agents ?? 0} agents · ${r.workflows ?? 0} workflows · ${r.dashboard_runs ?? 0} runs · ${r.alert_rules ?? 0} rules)`
  );
}

// ── Remote sources ──────────────────────────────────────────────────────────

/** Render combined and provider-specific counters from a remote-source sync. */
function syncSummaryLine(prefix, result) {
  const providers = ["claude", "codex"]
    .map((provider) => {
      const detail = result.providers?.[provider];
      if (!detail) return null;
      const name = provider === "codex" ? "Codex" : "Claude";
      return detail.status === "ok"
        ? `${name} ${detail.imported ?? 0} imported/${detail.sessions_tagged ?? 0} tagged`
        : `${name} ${detail.status}`;
    })
    .filter(Boolean);
  return `${prefix}: ${result.imported ?? 0} imported, ${result.sessions_tagged ?? 0} tagged${providers.length ? ` (${providers.join(", ")})` : ""}`;
}

async function listRemotes() {
  const { sources = [] } = await get("/api/remote-sources");
  if (isJson()) return printJson({ sources });
  table(
    ["ID", "Auto", "Status", "Label", "Host", "Sessions", "Last sync"],
    sources.map((s) => [
      s.id,
      s.enabled ? c.green("on") : c.dim("off"),
      `${s.status} (${s.claude_status || "idle"}/${s.codex_status || "idle"})`,
      (s.label || "").slice(0, 24),
      `${s.host}${s.ssh_port ? `:${s.ssh_port}` : ""}`,
      String(s.session_count ?? 0),
      s.last_sync_at
        ? `${new Date(s.last_sync_at).toLocaleString()} ${c.dim(`(${fmtAgo(s.last_sync_at)})`)}`
        : "-",
    ])
  );
  if (sources.length > 0) {
    const totalSessions = sources.reduce((n, s) => n + (s.session_count || 0), 0);
    const enabled = sources.filter((s) => s.enabled).length;
    console.log(
      c.dim(
        `  ${sources.length} source(s), ${enabled} auto-syncing, ${totalSessions} session(s) collected`
      )
    );
  } else {
    console.log(c.dim("  No remote sources configured. Add one: ccam remote-sources add --help"));
  }
}

async function showRemote({ args }) {
  const { sources = [] } = await get("/api/remote-sources");
  const s = sources.find(
    (x) => x.id === args[0] || x.id.startsWith(args[0]) || x.label === args[0]
  );
  if (!s) throw new CliError(`Remote source not found: ${args[0]}`, { code: "NOT_FOUND" });
  if (isJson()) return printJson({ source: s });
  console.log(`${c.cyan("▍")}${c.bold(s.label)} ${c.dim(`(${s.id})`)}`);
  kvCard([
    ["Host", `${s.host}${s.ssh_port ? `:${s.ssh_port}` : ""}`],
    ["Auto-sync", onOff(s.enabled)],
    [
      "Status",
      `${colorStatus(s.status)} ${c.dim(`claude ${s.claude_status || "idle"} · codex ${s.codex_status || "idle"}`)}`,
    ],
    ["Identity", s.identity_file || c.dim("ssh default")],
    ["Claude home", s.remote_home || c.dim("~/.claude")],
    ["Codex home", s.remote_codex_home || c.dim("~/.codex")],
    ["Sessions", String(s.session_count ?? 0)],
    [
      "Last sync",
      s.last_sync_at ? `${s.last_sync_at} ${c.dim(`(${fmtAgo(s.last_sync_at)})`)}` : "-",
    ],
    s.last_error ? ["Last error", c.red(s.last_error)] : null,
  ]);
}

async function addRemote({ opts }) {
  if (!opts.label || !opts.host) {
    throw new CliError("add requires --label and --host", {
      code: "USAGE",
      hints: [
        "e.g. ccam remote-sources add --label 'Dev box' --host son@dev --port 22 --identity ~/.ssh/id_ed25519",
      ],
    });
  }
  const r = await post("/api/remote-sources", {
    label: String(opts.label),
    host: String(opts.host),
    ssh_port: opts.port ?? null,
    identity_file: opts.identity ?? null,
    remote_home: opts.remoteHome ?? null,
    remote_codex_home: opts.remoteCodexHome ?? null,
    enabled: !opts.disabled,
  });
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Added remote source ${c.bold(r.source.label)} (${r.source.id})`);
}

async function updateRemote({ args, opts }) {
  const body = { ...(readJsonInput(opts) || {}) };
  if (opts.label !== undefined) body.label = opts.label;
  if (opts.host !== undefined) body.host = opts.host;
  if (opts.port !== undefined) body.ssh_port = opts.port;
  if (opts.identity !== undefined) body.identity_file = opts.identity;
  if (opts.remoteHome !== undefined) body.remote_home = opts.remoteHome;
  if (opts.remoteCodexHome !== undefined) body.remote_codex_home = opts.remoteCodexHome;
  if (!Object.keys(body).length) {
    throw new CliError("Nothing to update — pass field flags or --data JSON.", { code: "USAGE" });
  }
  await confirm(opts, {
    prompt: `Update remote source ${args[0]}?`,
    refusal: "remote-sources update requires --yes.",
  });
  const r = await patch(`/api/remote-sources/${enc(args[0])}`, body);
  if (isJson()) return printJson(r);
  console.log(`${c.green("OK")} Updated remote source ${r.source.id}`);
}

async function toggleRemote(id, enabled, opts) {
  await confirm(opts, {
    prompt: `${enabled ? "Enable" : "Disable"} auto-sync for remote source ${id}?`,
    refusal: "remote-sources enable/disable requires --yes.",
  });
  const r = await patch(`/api/remote-sources/${enc(id)}`, { enabled });
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} Remote source ${id} auto-sync ${enabled ? c.green("enabled") : c.dim("disabled")}`
  );
}

async function testRemote({ args }) {
  const r = await post(`/api/remote-sources/${enc(args[0])}/test`, undefined, {
    timeoutMs: 120_000,
  });
  if (!r.ok) process.exitCode = 1;
  if (isJson()) return printJson(r);
  console.log(r.ok ? `${c.green("OK")} ${r.message}` : `${c.red("ERR")} ${r.message}`);
  for (const provider of ["claude", "codex"]) {
    const detail = r.providers?.[provider];
    if (!detail) continue;
    const icon = detail.status === "ok" ? c.green("OK") : c.yellow("•");
    console.log(
      c.dim(
        `  ${icon} ${provider === "codex" ? "Codex" : "Claude Code"}: ${detail.status} — ${detail.path}`
      )
    );
  }
}

async function syncRemote({ args }) {
  const long = { timeoutMs: 600_000 };
  if (args[0]) {
    const r = await post(`/api/remote-sources/${enc(args[0])}/sync`, undefined, long);
    if (isJson()) return printJson(r);
    console.log(syncSummaryLine(`${c.green("OK")} Synced ${args[0]}`, r));
    return;
  }
  // No id → sync every source sequentially (per-source failures isolated).
  const { sources = [] } = await get("/api/remote-sources");
  const results = [];
  for (const s of sources) {
    let r;
    try {
      r = await post(`/api/remote-sources/${enc(s.id)}/sync`, undefined, long);
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      r = { ok: false, error: err.message };
      process.exitCode = 1;
    }
    results.push({ id: s.id, label: s.label, ...r });
    if (!isJson()) {
      console.log(
        r.error
          ? `  ${c.red("ERR")} ${c.bold(s.label)}: ${r.error}`
          : syncSummaryLine(`  ${c.bold(s.label)}`, r)
      );
    }
  }
  if (isJson()) return printJson({ synced: results.length, results });
  console.log(`${c.green("OK")} Synced ${sources.length} source(s)`);
}

async function removeRemote({ args, opts }) {
  const purge = Boolean(opts.purge);
  if (purge && opts.confirm !== "PURGE_REMOTE_SOURCE_DATA") {
    throw new CliError("--purge requires --confirm PURGE_REMOTE_SOURCE_DATA.", {
      code: "CONFIRMATION_REQUIRED",
    });
  }
  const r = await del(`/api/remote-sources/${enc(args[0])}${purge ? "?purge=true" : ""}`);
  if (isJson()) return printJson(r);
  console.log(
    `${c.green("OK")} Removed ${args[0]}${purge ? ` (purged ${r.purged} session(s))` : " (data kept)"}`
  );
}

function remoteFieldOptions(cmd) {
  return cmd
    .option("--label <label>", "display label")
    .option("--host <host>", "SSH target, e.g. user@host")
    .option("--port <n>", "SSH port", posIntArg)
    .option("--identity <path>", "SSH identity file")
    .option("--remote-home <path>", "remote Claude home (default ~/.claude)")
    .option("--remote-codex-home <path>", "remote Codex home (default ~/.codex)");
}

function register(program) {
  const imp = program
    .command("import")
    .helpGroup(IMPORT_GROUP)
    .description("Import Claude Code / Codex history: guide, rescan, path, upload, reimport");
  imp
    .command("guide")
    .description("Provider-specific import locations and limits (raw JSON; --format pretty)")
    .addOption(providerOption())
    .action(run(importGuide, { serverOnly: IMPORT_ONLY }));
  imp
    .command("rescan")
    .description("Re-scan the default history directory")
    .addOption(providerOption())
    .action(run(importRescan, { serverOnly: IMPORT_ONLY }));
  imp
    .command("path")
    .description("Import every supported history file under a directory")
    .argument("<dir>", "directory to scan")
    .addOption(providerOption())
    .action(run(importPath, { serverOnly: IMPORT_ONLY }));
  imp
    .command("upload")
    .description("Upload JSONL files or archives (.zip/.tar.gz)")
    .argument("<files...>", "files to upload")
    .addOption(providerOption())
    .action(run(importUpload, { serverOnly: IMPORT_ONLY }));
  imp
    .command("reimport")
    .description("Re-import all local Claude Code and Cursor history (idempotent)")
    .action(run(importReimport, { serverOnly: IMPORT_ONLY }));

  program
    .command("import-data")
    .helpGroup(IMPORT_GROUP)
    .description("Restore a dashboard export (.json) — idempotent, merges machines")
    .argument("<file>", "export file")
    .action(
      run(importData, {
        serverOnly: "restoring an export writes to the database through the server",
      })
    );

  const REMOTE_ONLY = "remote sources are managed and synced by the running server";
  const remotes = listGroup(program, "remote-sources", {
    group: REMOTE_GROUP,
    aliases: ["remotes"],
    description: "SSH machines to mirror Claude Code / Codex history from (default: list)",
    handler: listRemotes,
    serverOnly: REMOTE_ONLY,
  });
  remotes
    .command("get")
    .alias("show")
    .description("One source's detail and last error")
    .argument("<id>", "source id, prefix, or label")
    .action(run(showRemote, { serverOnly: REMOTE_ONLY }));
  remoteFieldOptions(remotes.command("add").description("Add a source (--label, --host required)"))
    .option("--disabled", "add without auto-sync")
    .action(run(addRemote, { serverOnly: REMOTE_ONLY }));
  jsonBodyOptions(
    remoteFieldOptions(
      remotes
        .command("update")
        .description("Update a source (partial)")
        .argument("<id>", "source id")
    ),
    "fields"
  )
    .option("-y, --yes", "confirm the write")
    .action(run(updateRemote, { serverOnly: REMOTE_ONLY }));
  remotes
    .command("enable")
    .description("Turn auto-sync on")
    .argument("<id>", "source id")
    .option("-y, --yes", "confirm the change")
    .action(
      run(({ args, opts }) => toggleRemote(args[0], true, opts), { serverOnly: REMOTE_ONLY })
    );
  remotes
    .command("disable")
    .description("Turn auto-sync off")
    .argument("<id>", "source id")
    .option("-y, --yes", "confirm the change")
    .action(
      run(({ args, opts }) => toggleRemote(args[0], false, opts), { serverOnly: REMOTE_ONLY })
    );
  remotes
    .command("test")
    .description("Probe SSH connectivity and provider paths (exit 1 on failure)")
    .argument("<id>", "source id")
    .action(run(testRemote, { serverOnly: REMOTE_ONLY }));
  remotes
    .command("sync")
    .description("Pull history now (all sources when the id is omitted)")
    .argument("[id]", "source id")
    .action(run(syncRemote, { serverOnly: REMOTE_ONLY }));
  remotes
    .command("rm")
    .alias("remove")
    .description("Remove a source (--purge also deletes its collected data)")
    .argument("<id>", "source id")
    .option("--purge", "also delete sessions collected from it")
    .option("--confirm <token>", "PURGE_REMOTE_SOURCE_DATA (required with --purge)")
    .action(run(removeRemote, { serverOnly: REMOTE_ONLY }));
}

module.exports = { register };
