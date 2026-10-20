# DualAgent Nexus v3 — handoff for the next session

**Published:** https://github.com/juanmarboledao2304/dual-agent-nexus (public, default branch
`main`, milestone `v3.0.0` open). Version **3.0.0**. All local gates green on Windows: server
1456 pass / 0 fail / 10 skipped (symlink tests skip without Developer Mode), client 550/550,
`tsc` 0 errors, build OK, header + i18n audits clean.

The v3 work was done in a temporary worktree
(`C:\Users\juanm\Claude\dual-agent-nexus\.claude\worktrees\v3-pixel-rooms`, branch
`worktree-v3-pixel-rooms`, remote `nexus`). The user's main checkout
`C:\Users\juanm\Claude\dual-agent-nexus` is still on the old `master` (v2, port 4820), and the
installed hooks point at it.

## Open items, in order

1. **Move the main checkout to v3** (run from `C:\Users\juanm\Claude\dual-agent-nexus`):
   `git remote add nexus https://github.com/juanmarboledao2304/dual-agent-nexus.git` (skip if it
   exists), `git fetch nexus`, `git checkout -B main nexus/main`, then `npm ci`,
   `npm --prefix client ci`, `npm run build`. Keep `master` as-is (it is the v2 history).
2. **Re-wire hooks to port 7770** from that checkout:
   `node scripts/install-hooks.js --claude --antigravity`. Verify `~/.gemini/config/hooks.json`
   curl hooks now say `127.0.0.1:7770` (4 entries, no duplicates) and `~/.claude/settings.json`
   hook-handler paths point at the main checkout.
3. **Smoke test**: `npm start` (background, port 7770), open `http://127.0.0.1:7770/rooms`, click
   Run Swarm Simulation, confirm L1/L2/L3 pods, the Exit 10 failover, and the DIGEST vault.
4. **CI**: check the first GitHub Actions run on `main` (`gh run list -R
   juanmarboledao2304/dual-agent-nexus`) and fix anything Linux-specific.
5. **Desktop app** (optional): TypeScript typechecks clean, but packaging and the smoke test need
   Electron's binary and a better-sqlite3 native build (Node 22 LTS or a C++ toolchain):
   `cd desktop && npm install && npm run build`.
6. **Cleanup**: once the main checkout is on v3, the worktree can be removed with
   `git worktree remove .claude/worktrees/v3-pixel-rooms` (from the main checkout).

## Prompt to paste in the next conversation

Open Claude Code in `C:\Users\juanm\Claude\dual-agent-nexus` and paste:

> DualAgent Nexus v3 is published at https://github.com/juanmarboledao2304/dual-agent-nexus
> (branch `main`). Read
> `C:\Users\juanm\Claude\dual-agent-nexus\.claude\worktrees\v3-pixel-rooms\docs\history\NEXT_SESSION.md`
> and do its "Open items" in order: move this checkout to `nexus/main`, re-wire the hooks to port
> 7770, smoke-test the swarm, and check the first CI run. Keep the UI emoji-free and
> `npm run verify` green; commit and push any fixes to `main`.
