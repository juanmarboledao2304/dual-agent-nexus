/**
 * @file The ccam interactive shell (`ccam repl`, aliases `shell` / `i`).
 *
 * Commands are typed WITHOUT the `ccam` prefix. Each line runs as a
 * short-lived child `ccam` process, so behavior is byte-identical to the
 * one-shot CLI and a command that exits non-zero, blocks (tail, stream), or
 * refuses offline can never take the shell down. While a child runs, the
 * shell's readline is paused and the terminal leaves raw mode, so Ctrl+C
 * reaches the child as a real SIGINT and interactive y/N confirmations work.
 *
 * Built-ins: help / help <cmd>, commands, watch [secs] <cmd>, json (toggle
 * JSON output for subsequent commands), history, banner, clear, exit.
 * Tab-completion is driven by the same Commander command tree that powers
 * `ccam completion`, so it knows every subcommand, option, and choice.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { c, useColor, stripAnsi, termWidth } = require("./lib/ui");
const { REPO_ROOT, ENTRY, pkgVersion, state } = require("./lib/runtime");
const { baseUrl, serverIsUp } = require("./lib/http");
const { completeWords, visibleSubcommands } = require("./lib/framework");

/** Split a REPL input line into argv, honoring single/double quotes so
 *  `session "my id"` and `pricing set 'foo%'` tokenize correctly. */
function tokenizeLine(line) {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const BUILTINS = [
  "help",
  "commands",
  "watch",
  "json",
  "history",
  "banner",
  "clear",
  "exit",
  "quit",
];

// The CCAM word-mark, shown once when the interactive shell starts (and via
// the `banner` built-in). Kept as raw text so the backslashes render verbatim.
const BANNER_ART = String.raw`
          _____                    _____                    _____                    _____
         /\    \                  /\    \                  /\    \                  /\    \
        /::\    \                /::\    \                /::\    \                /::\____\
       /::::\    \              /::::\    \              /::::\    \              /::::|   |
      /::::::\    \            /::::::\    \            /::::::\    \            /:::::|   |
     /:::/\:::\    \          /:::/\:::\    \          /:::/\:::\    \          /::::::|   |
    /:::/  \:::\    \        /:::/  \:::\    \        /:::/__\:::\    \        /:::/|::|   |
   /:::/    \:::\    \      /:::/    \:::\    \      /::::\   \:::\    \      /:::/ |::|   |
  /:::/    / \:::\    \    /:::/    / \:::\    \    /::::::\   \:::\    \    /:::/  |::|___|______
 /:::/    /   \:::\    \  /:::/    /   \:::\    \  /:::/\:::\   \:::\    \  /:::/   |::::::::\    \
/:::/____/     \:::\____\/:::/____/     \:::\____\/:::/  \:::\   \:::\____\/:::/    |:::::::::\____\
\:::\    \      \::/    /\:::\    \      \::/    /\::/    \:::\  /:::/    /\::/    / ~~~~~/:::/    /
 \:::\    \      \/____/  \:::\    \      \/____/  \/____/ \:::\/:::/    /  \/____/      /:::/    /
  \:::\    \               \:::\    \                       \::::::/    /               /:::/    /
   \:::\    \               \:::\    \                       \::::/    /               /:::/    /
    \:::\    \               \:::\    \                      /:::/    /               /:::/    /
     \:::\    \               \:::\    \                    /:::/    /               /:::/    /
      \:::\    \               \:::\    \                  /:::/    /               /:::/    /
       \:::\____\               \:::\____\                /:::/    /               /:::/    /
        \::/    /                \::/    /                \::/    /                \::/    /
         \/____/                  \/____/                  \/____/                  \/____/
`;

/** Print the entry banner: word-mark (when wide enough), tagline, tips. */
function replBanner(up) {
  const v = pkgVersion();
  if (termWidth() >= 100) console.log(c.cyan(BANNER_ART));
  else console.log(`\n${c.cyan("▍")}${c.bold("ccam")}`);
  const dot = up ? c.green("●") : c.red("○");
  const where = up ? baseUrl().replace(/^https?:\/\//, "") : "offline";
  console.log(
    `  ${c.bold("DualAgent Nexus")} ${c.dim("· interactive shell")}` +
      (v ? c.dim(` · v${v}`) : "") +
      `   ${dot} ${c.dim(where)}`
  );
  console.log(
    c.dim("  Type commands without the 'ccam' prefix — e.g. ") + c.bold("sessions --limit 5")
  );
  console.log(
    c.dim("  ") +
      c.bold("help") +
      c.dim(" all commands · ") +
      c.bold("help <cmd>") +
      c.dim(" details · Tab completes · ↑/↓ history · ") +
      c.bold("exit") +
      c.dim(" to quit")
  );
  console.log();
}

/** Group top-level commands by their help group (derived, never hand-kept). */
function groupedCommands(program) {
  const groups = new Map();
  for (const s of visibleSubcommands(program)) {
    const g = (s.helpGroup() || "Commands:").replace(/:$/, "");
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  return groups;
}

/** One catalog line: `  cmd <args>          description`. */
function catalogRow(cmd) {
  const args = cmd.registeredArguments
    .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
    .join(" ");
  const subs = visibleSubcommands(cmd).map((s) => s.name());
  let hint = args;
  if (!hint && subs.length) {
    // Fit as many subcommand names as the 34-column name slot allows.
    const room = 32 - cmd.name().length;
    hint = subs[0];
    for (const s of subs.slice(1)) {
      if (`${hint}|${s}|…`.length > room) {
        hint += "|…";
        break;
      }
      hint += `|${s}`;
    }
  }
  const left = `${c.cyan(cmd.name())}${hint ? ` ${c.dim(hint)}` : ""}`;
  const pad = " ".repeat(Math.max(2, 34 - stripAnsi(left).length));
  return `  ${left}${pad}${cmd.description()}`;
}

/** Categorized REPL help: shell built-ins first, then the command catalog. */
function replHelp(program) {
  const row = (name, desc) => `  ${c.cyan(name.padEnd(22))}${desc}`;
  console.log(`\n${c.cyan("▍")}${c.bold("ccam shell")} ${c.dim("— built-ins")}`);
  console.log(row("help", "This help. " + c.dim("`help <command>` shows one command's details")));
  console.log(row("commands", "Compact list of every command, grouped"));
  console.log(
    row("watch [secs] <cmd>", "Re-run a command on a timer, screen-clearing (Ctrl+C stops)")
  );
  console.log(row("json", "Toggle JSON output for the following commands"));
  console.log(row("history", "Show recent command history"));
  console.log(row("banner", "Reprint the welcome banner"));
  console.log(row("clear, cls", "Clear the screen"));
  console.log(row("exit, quit, q", "Leave the shell (also Ctrl+D)"));
  for (const [group, cmds] of groupedCommands(program)) {
    console.log(`\n${c.cyan("▍")}${c.bold(group)}`);
    for (const cmd of cmds) console.log(catalogRow(cmd));
  }
  console.log(
    `\n${c.dim("Read commands work offline; server-only commands print the reason. Each line runs isolated, so nothing takes the shell down.")}\n`
  );
}

/** Compact grouped command list for the `commands` built-in. */
function replCommandsList(program) {
  for (const [group, cmds] of groupedCommands(program)) {
    console.log(`  ${c.bold(group.padEnd(20))}${cmds.map((s) => c.cyan(s.name())).join("  ")}`);
  }
}

/**
 * The interactive shell. Reads lines, dispatches each as a child `ccam`
 * process (inheriting stdio so tables/colors/streaming render natively), and
 * keeps a persisted history. On a TTY the prompt shows live server status;
 * piped input (tests, scripts) runs each line and exits at EOF.
 */
async function startRepl(program) {
  const readline = require("node:readline");
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const historyFile = path.join(REPO_ROOT, "data", ".ccam_repl_history");
  let jsonMode = state.output === "json";

  let history = [];
  try {
    history = fs.readFileSync(historyFile, "utf8").split("\n").filter(Boolean).slice(-500);
  } catch {
    /* no history yet */
  }

  const completer = (line) => {
    const words = tokenizeLine(line);
    if (/\s$/.test(line) || !line) words.push("");
    const partial = words[words.length - 1];
    let hits = completeWords(program, words);
    if (words.length === 1)
      hits = [...new Set([...hits, ...BUILTINS.filter((b) => b.startsWith(partial))])];
    return [hits, partial];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: isTty,
    completer: isTty ? completer : undefined,
    history: history.slice().reverse(), // readline wants most-recent first
    historySize: 500,
    prompt: "",
  });

  // Cache the health probe briefly so the prompt does not hammer the server.
  let statusCache = { at: 0, up: false };
  async function serverUpCached() {
    const now = Date.now();
    if (now - statusCache.at < 3000) return statusCache.up;
    const up = await serverIsUp();
    statusCache = { at: now, up };
    return up;
  }

  async function renderPrompt() {
    if (!isTty) return; // piped input needs no prompt
    const up = await serverUpCached();
    const dot = up ? c.green("●") : c.red("○");
    const where = up ? c.dim(baseUrl().replace(/^https?:\/\//, "")) : c.dim("offline");
    const mode = jsonMode ? ` ${c.yellow("[json]")}` : "";
    rl.setPrompt(`${dot} ${c.bold("ccam")} ${where}${mode} ${c.cyan("›")} `);
    rl.prompt();
  }

  // Ctrl+C must never kill the shell: a no-op process handler keeps the
  // parent alive while a child is the real SIGINT target; the readline
  // SIGINT event (fires only at the prompt) just resets the line.
  let childActive = false;
  const sigintNoop = () => {};
  process.on("SIGINT", sigintNoop);
  let watching = false;
  rl.on("SIGINT", () => {
    if (childActive || watching) return;
    console.log(c.dim("  (type exit or press Ctrl+D to quit)"));
    renderPrompt();
  });

  /** Run one child `ccam` invocation with inherited stdio. */
  function runChild(argv) {
    return new Promise((resolve) => {
      childActive = true;
      // Hand the terminal to the child: stop reading, leave raw mode so
      // Ctrl+C is delivered as SIGINT and the child can prompt for y/N.
      if (isTty) {
        rl.pause();
        try {
          process.stdin.setRawMode(false);
        } catch {
          /* not a raw-capable stream */
        }
      }
      const env = { ...process.env, CCAM_REPL: "1" };
      if (useColor && !jsonMode) env.FORCE_COLOR = "1";
      if (state.url) env.CCAM_URL = state.url;
      const args = jsonMode && !argv.includes("--json") ? [...argv, "--json"] : argv;
      const child = spawn(process.execPath, [ENTRY, ...args], { stdio: "inherit", env });
      const done = () => {
        childActive = false;
        if (isTty) {
          try {
            process.stdin.setRawMode(true);
          } catch {
            /* ignore */
          }
          rl.resume();
        }
        resolve();
      };
      child.on("close", done);
      child.on("error", (err) => {
        console.error(c.red(`ERR ${err?.message || err}`));
        done();
      });
    });
  }

  /** `watch <cmd…>` — re-run a command on a timer until Ctrl+C. */
  async function runWatch(argv, intervalMs) {
    let abort = false;
    const onSig = () => {
      abort = true;
    };
    // Ctrl+C during a child arrives as a real SIGINT (raw mode is off); during
    // the wait between runs the terminal is back in raw mode, so it arrives
    // as readline's SIGINT event instead — listen on both.
    process.prependListener("SIGINT", onSig);
    rl.on("SIGINT", onSig);
    watching = true;
    try {
      while (!abort) {
        if (isTty) process.stdout.write("\x1b[2J\x1b[H");
        console.log(
          c.dim(
            `⟳ watch: ccam ${argv.join(" ")} — every ${Math.round(intervalMs / 1000)}s · ${new Date().toLocaleTimeString()} · Ctrl+C to stop`
          )
        );
        await runChild(argv);
        if (abort) break;
        await new Promise((r) => {
          const done = () => {
            clearInterval(poll);
            clearTimeout(timer);
            r();
          };
          const poll = setInterval(() => abort && done(), 100);
          const timer = setTimeout(done, intervalMs);
        });
      }
    } finally {
      watching = false;
      process.removeListener("SIGINT", onSig);
      rl.removeListener("SIGINT", onSig);
    }
  }

  if (isTty) replBanner(await serverUpCached());

  // `for await` pulls one line at a time and only requests the next once the
  // body finishes — this serializes command execution (crucial for piped
  // input, where naive 'line' listeners would interleave async handlers).
  await renderPrompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) {
      await renderPrompt();
      continue;
    }
    let toks = tokenizeLine(line);
    if (toks[0] === "ccam") toks = toks.slice(1); // tolerate a typed prefix
    const head = toks[0];
    if (!head) {
      await renderPrompt();
      continue;
    }

    // Shell built-ins run in-process (no child spawn).
    if (["exit", "quit", "q", ":q"].includes(head)) break;
    if (head === "clear" || head === "cls") {
      if (isTty) process.stdout.write("\x1b[2J\x1b[H");
    } else if (head === "banner") {
      replBanner(await serverUpCached());
    } else if ((head === "help" || head === "?") && toks.length === 1) {
      replHelp(program);
    } else if (head === "help" || head === "?") {
      await runChild(["help", ...toks.slice(1)]);
    } else if (head === "commands" && toks.length === 1) {
      replCommandsList(program);
    } else if (head === "json") {
      jsonMode = toks[1] ? /^(on|1|true|yes)$/i.test(toks[1]) : !jsonMode;
      console.log(c.dim(`JSON output ${jsonMode ? "on" : "off"}.`));
    } else if (head === "watch") {
      if (!isTty) {
        console.log(c.dim("watch needs an interactive terminal."));
      } else {
        // `watch <cmd…>` (default 2s) or `watch <secs> <cmd…>`.
        let rest = toks.slice(1);
        let secs = 2;
        if (rest.length && /^\d+$/.test(rest[0])) {
          secs = Math.max(1, Number(rest[0]));
          rest = rest.slice(1);
        }
        if (!rest.length)
          console.log(c.dim("Usage: watch [seconds] <command …>   e.g. watch 5 stats"));
        else await runWatch(rest, secs * 1000);
      }
    } else if (head === "history") {
      const recent = history.slice(-30);
      recent.forEach((h, i) =>
        console.log(`${c.dim(String(history.length - recent.length + i + 1).padStart(4))}  ${h}`)
      );
    } else if (head === "repl" || head === "shell" || head === "i") {
      console.log(c.dim("Already in the ccam shell."));
    } else {
      // Record history (skip consecutive duplicates), then dispatch as a child.
      if (history[history.length - 1] !== line) {
        history.push(line);
        try {
          fs.mkdirSync(path.dirname(historyFile), { recursive: true });
          fs.appendFileSync(historyFile, line + "\n");
        } catch {
          /* history is best-effort */
        }
      }
      await runChild(toks);
    }
    await renderPrompt();
  }

  rl.close();
  if (isTty) console.log(c.dim("Bye."));
  process.removeListener("SIGINT", sigintNoop);
}

module.exports = { startRepl, tokenizeLine };
