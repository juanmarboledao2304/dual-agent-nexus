/**
 * @file Probes once whether this host can create file and directory symlinks. Windows refuses
 * symlink creation (EPERM) unless Developer Mode is on or the process is elevated, so symlink
 * fixtures there are skipped with an explicit reason instead of crashing the suite. On Linux and
 * macOS (and CI) the probe succeeds and every symlink test runs.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

function probe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symlink-probe-"));
  try {
    fs.writeFileSync(path.join(dir, "target.txt"), "x");
    fs.mkdirSync(path.join(dir, "target-dir"));
    fs.symlinkSync(path.join(dir, "target.txt"), path.join(dir, "file-link"), "file");
    fs.symlinkSync(path.join(dir, "target-dir"), path.join(dir, "dir-link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort probe cleanup */
    }
  }
}

const CAN_SYMLINK = probe();

/** `node:test` skip option: false when symlinks work, else the reason they are skipped. */
const SKIP_WITHOUT_SYMLINKS = CAN_SYMLINK
  ? false
  : "host cannot create symlinks (enable Windows Developer Mode to run this test)";

module.exports = { CAN_SYMLINK, SKIP_WITHOUT_SYMLINKS };
