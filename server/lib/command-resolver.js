/**
 * @file Resolve a CLI name (claude, agy, agy-cascade) to a spawnable command line. On Windows a bare
 * name handed to `spawn(..., { shell: true })` goes through cmd.exe, which cannot run an extensionless
 * bash script such as `~/.local/bin/agy-cascade` and also splits unquoted multi-word prompts. This
 * module walks PATH/PATHEXT itself: native executables spawn directly, shebang scripts run through
 * Git Bash, and .cmd/.bat shims go through cmd.exe with every argument quoted.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("node:fs");
const path = require("node:path");

/** True when `file` exists and is a regular file. */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** True when the file starts with a `#!` shebang line. */
function hasShebang(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      return buf.toString("utf8") === "#!";
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Locate Git Bash. WSL's `C:\Windows\System32\bash.exe` is deliberately never used: it runs in a
 * different filesystem namespace and cannot see Windows paths the way the scripts expect.
 *
 * @param {NodeJS.ProcessEnv} env - Environment to read PATH and NEXUS_BASH from.
 * @returns {string|null} Absolute path to bash.exe, or null.
 */
function findGitBash(env = process.env) {
  if (env.NEXUS_BASH && isFile(env.NEXUS_BASH)) return env.NEXUS_BASH;
  const dirs = String(env.PATH || env.Path || "")
    .split(path.win32.delimiter)
    .filter(Boolean);
  for (const dir of dirs) {
    const git = path.win32.join(dir, "git.exe");
    if (!isFile(git)) continue;
    // <Git>\cmd\git.exe or <Git>\bin\git.exe -> <Git>\bin\bash.exe
    const candidate = path.win32.join(dir, "..", "bin", "bash.exe");
    if (isFile(candidate)) return path.win32.resolve(candidate);
  }
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs"),
  ];
  for (const root of roots.filter(Boolean)) {
    const candidate = path.win32.join(root, "Git", "bin", "bash.exe");
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Quote one argument for cmd.exe: wrap in double quotes and double any embedded quote. */
function quoteForCmd(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/**
 * Resolve how to spawn `bin` with `args`.
 *
 * @param {string} bin - Bare command name.
 * @param {string[]} args - Arguments.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ command: string, args: string[], shell: boolean, resolved: string|null, via: string } | null}
 *   null when the command cannot be found (or, for a script, no Git Bash exists).
 */
function resolveCommand(bin, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32") {
    return { command: bin, args, shell: false, resolved: null, via: "direct" };
  }

  const dirs = String(env.PATH || env.Path || "")
    .split(path.win32.delimiter)
    .filter(Boolean);
  const exts = String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((e) => e.toLowerCase());

  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.win32.join(dir, bin + ext);
      if (!isFile(file)) continue;
      if (ext === ".exe" || ext === ".com") {
        return { command: file, args, shell: false, resolved: file, via: "direct" };
      }
      if (ext === ".cmd" || ext === ".bat") {
        return {
          command: quoteForCmd(file),
          args: args.map(quoteForCmd),
          shell: true,
          resolved: file,
          via: "cmd",
        };
      }
    }
    const bare = path.win32.join(dir, bin);
    if (isFile(bare) && hasShebang(bare)) {
      const bash = findGitBash(env);
      if (!bash) return null;
      // Forward slashes: Git Bash opens C:/... reliably, backslashes depend on MSYS path munging.
      const script = bare.replace(/\\/g, "/");
      return { command: bash, args: [script, ...args], shell: false, resolved: bare, via: "bash" };
    }
  }
  return null;
}

module.exports = { resolveCommand, findGitBash, quoteForCmd };
