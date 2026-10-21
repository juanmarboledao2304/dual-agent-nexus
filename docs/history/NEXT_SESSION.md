# DualAgent Nexus — handoff for the next session

**State (2026-10-21):** `main` carries 3.2.0 plus the live-sync fixes (PRs #2 and #3): Claude Code
session-registry sync (`NEXUS_LIVE_SYNC_MS`), real Claude limits through
`statusline/nexus-statusline.js`, real dispatch on Windows (`NEXUS_DISPATCH_SIMULATE` for demos), and
Opus 5.5 sessions labelled as Claude Code. Server tests 1478 pass / 10 skipped, client 565 pass,
typecheck and build clean. The docs, all eleven README screenshots, the promo video (44 s), its GIF
and VTT were regenerated to match. Capture recipe: seed a fresh DB with `DASHBOARD_DATA_DIR`,
`CLAUDE_HOME`, `HOME`, and `USERPROFILE` pointing at a temp dir and `DASHBOARD_PORT=7790`; before
each shot POST sample `rate_limits` to `/api/quota/claude-limits` (so the meter shows the real-limit
mode) and start `POST /api/simulate/swarm` with `{ "cwd": "/home/dev/dual-agent-nexus" }` so no local
path leaks; shoot at 1440x900 between 11 and 17 s (pool 1 out of quota, approval pending), with
`localStorage` `i18nextLng=en` and `provider-onboarding-shown-v2=1`. Video GIF:
`npx remotion render Video-Nexus out/dualagent-nexus-tour.gif --codec=gif --every-nth-frame=3
--frames=299-746 --scale=0.41667` (Remotion's bundled ffmpeg lacks the `fps`/`palettegen` filters).

## State (2026-10-20)

**State (2026-10-20):** version **3.2.0** ships the **Nexus Console redesign** (PR #1, merged into
`main`, tag `v3.2.0`). The visual follow-ups (dispatcher, Analytics and graph colours, Settings labels)
are done; what remains is listed under "Still open" in the plan. Original branch `worktree-redesign-clarity` carried the **Nexus Console redesign**
(five sections: Command, Agents, Sessions, Usage, Settings; Duet and Console themes; fuel gauge;
Needs-you rule; Launch panel). Decisions and tokens: `docs/plans/2026-10-20-nexus-console-redesign.md`.
README screenshots come from an isolated demo server (fake `USERPROFILE`/`HOME`, `npm run seed`,
Simulate swarm); never capture README images from the real database. The promo video source lives
outside the repo in `C:\Users\juanm\Claude\Video Nexus` (Remotion: `npm run voz`, then
`python herramientas/musica_minimal.py`, then `npm run render`).

---

## Previous state (2026-10-19)

**State (2026-10-19):** version **3.1.0** on local branch `redesign/nexus-signal` (based on
`main`, which tracks `nexus/main` at v3.0.0). The main checkout
`C:\Users\juanm\Claude\dual-agent-nexus` is on v3; hooks point at port 7770 (Claude Code
`~/.claude/settings.json` and Antigravity `~/.gemini/config/hooks.json`; backups saved as
`*.bak-pre-v3`). The first CI runs on `main` were green on Linux, macOS, and Windows.

## What 3.1.0 contains

- **Nexus Signal design system** (`client/tailwind.config.js`, `client/src/index.css`): graphite
  neutral ramp (Tailwind `gray` and `slate`), new surfaces and borders, a single Ember accent
  (`#ff8a3d`), hairline elevation, `.page-title` / `.section-title` / `.micro-label`.
- **Top navigation shell** (`client/src/components/shell/`) replacing the inherited sidebar:
  short route tabs, search icon (command palette), live pill with the connection modal, update
  check, language picker, GitHub link, and the single primary **Run agent** action.
- **Agent World** at `/world` (`client/src/pages/AgentWorld.tsx`, `components/world/`,
  `utils/world/`): 3/4-perspective canvas office with live agents (read-only) and sandbox agents
  (create, pause, resume, rename, drag, move between rooms, delete; persisted in `localStorage`).
- Type-led page headers, redesigned `StatCard`, calmer `DualQuotaHeader` inside the content
  column. Plan: `docs/plans/2026-10-19-nexus-redesign-world.md`.

## Open items

1. **Public repo:** the user asked to delete `juanmarboledao2304/dual-agent-nexus`. `gh` needs
   the `delete_repo` scope first: `gh auth refresh -h github.com -s delete_repo`, then
   `gh repo delete juanmarboledao2304/dual-agent-nexus --yes`. The local clone keeps all history
   and the `v2.2.6`, `v2.3.0`, `v3.0.0` tags. The project stays an MIT-licensed derivative of
   Claude-Code-Agent-Monitor: keep `LICENSE` and every inherited `@author Son Nguyen` header.
2. **Merge** `redesign/nexus-signal` into `main` once reviewed (no remote to push to after the
   deletion).
3. **Further redesign passes** (optional): page bodies still use the inherited layouts
   (Dashboard sections, Sessions table, Settings); the token remap restyles them but their
   structure is unchanged.
4. **Cleanup:** remove the old worktree with
   `git worktree unlock .claude/worktrees/v3-pixel-rooms` then
   `git worktree remove .claude/worktrees/v3-pixel-rooms`.
