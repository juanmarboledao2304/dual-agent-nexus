# Tabby — Floating Companion (Design Spec)

**Date:** 2026-05-28
**Status:** Approved (design) — pending spec review before planning
**Owner:** Son Nguyen (David)
**Topic:** A cute-but-functional cat companion that lives in the dashboard's bottom corner, reacts to live session events, and expands into a panel for status, quick actions, and asking questions.

---

## 1. Summary

**Tabby** is a floating cat avatar pinned to the bottom-right corner of the Agent Dashboard on every route. It is two things at once:

1. **A reactive mascot** — an SVG cat whose face, ears, eyes, and posture react in real time to what the monitored Claude Code sessions are doing (a session finishes → tail-up, eyes `^^`; an error/hook fails → arch + ears-back; idle → curls up asleep). Eyes track the cursor when alert.
2. **An assistant** — click the avatar (or press `⌘B` / `Ctrl+B`) to expand a panel with a live status line, quick navigation actions, and an **Ask** box that answers simple questions from cached dashboard data, with a handoff to the existing **Run** page to ask Claude for real.

The "do the job" path reuses what already exists: `POST /api/run` spawns a real `claude` subprocess and streams over WebSocket. Tabby does **not** introduce any new LLM backend, API key, or server route in P1/P2. P3 adds a single client-only deep-link prefill.

Name **Tabby** matches the app's identity: this is a **Monitor** ("watching your agents"), and Tabby is the alert watcher curled in the corner.

---

## 2. Goals / Non-Goals

### Goals
- Delightful, on-theme personality layer over live session data — "cute but does the job."
- Always-present, low-footprint corner avatar that auto-surfaces notable events as transient speech bubbles, then settles.
- One-keystroke (`⌘B`) expand to a functional panel: status, quick actions, local Ask.
- Reuse the existing event stream (`eventBus`) and Run flow — no new backend in P1/P2.
- Fully consistent with the existing dark Tailwind theme (`surface-*`, `accent`, `border`).
- Accessible: keyboard-operable, `aria-live` bubbles, honors `prefers-reduced-motion`.
- Degrades safe: if WebSocket is down/delayed, Tabby shows a calm/disconnected state — never errors, never blocks the page.

### Non-Goals (YAGNI)
- No drag-to-reposition (fixed bottom-right).
- No sound effects.
- No new LLM/chat backend or API key (Ask is rule-based locally; real Claude = handoff to Run).
- No server-side persistence (preferences in `localStorage` only).
- No multi-avatar / skins / customization.
- No changes to existing pages beyond the minimal mount + the P3 Run prefill.

---

## 3. Where it lives (architecture)

```
App.tsx
  └─ useWebSocket(onMessage = eventBus.publish)   // single shared socket, already exists
  └─ Layout.tsx
        ├─ UpdateNotifier        (existing global floater)
        ├─ Tabby   ◀── NEW: mounted here, sibling of UpdateNotifier
        └─ <Outlet/>             (page routes)
```

- **Mount point:** `client/src/components/Layout.tsx`, right next to `<UpdateNotifier/>`. This guarantees Tabby persists across every route and shares the one WebSocket connection.
- **Data source:** the existing `eventBus` (`client/src/lib/eventBus.ts`).
  - `eventBus.subscribe(handler)` → every `WSMessage`.
  - `eventBus.onConnection(handler)` + `eventBus.connected` → WS up/down.
  - No prop drilling, no new context provider. The brain hook subscribes directly.
- **Navigation:** quick actions use `react-router` (`useNavigate`) to jump to existing routes (`/sessions`, `/sessions/:id`, `/activity`, `/run`).

### Component layout (new, isolated directory)

```
client/src/components/Tabby/
  Tabby.tsx          # Container. Owns open/collapsed/muted state, ⌘B + Esc handlers,
                     #   localStorage persistence. Composes the three presentational parts.
  CatAvatar.tsx      # Pure presentational SVG cat. Props: { mood, eyeTarget, reducedMotion }.
                     #   No data access — fully testable in isolation.
  SpeechBubble.tsx   # Transient bubble. Props: { text, onDismiss }. aria-live="polite",
                     #   auto-dismiss ~4.5s. No data access.
  TabbyPanel.tsx     # Expanded panel: status header + quick actions + Ask box.
                     #   Receives status summary + handlers as props.
  useTabbyBrain.ts   # The brain. Subscribes eventBus → derives { mood, statusSummary,
                     #   bubbleQueue }. Owns all timers (idle/sleep/stuck). The only unit
                     #   that touches eventBus.
  intents.ts         # Local Ask: maps a free-text question → templated answer from cached
                     #   status, or a { runHandoff: prompt } signal. Pure function.
  quips.ts           # mood/event → randomized phrase pool. The personality. Pure data + picker.
  tabby.css          # Keyframes (breathe/blink/ear-twitch/arch/tail-flick), translucency,
                     #   prefers-reduced-motion overrides.
```

**Boundaries / contracts:**
- `useTabbyBrain` is the *only* unit that subscribes to `eventBus`. Everything else receives plain props. This keeps the live-data surface in one place and the rest trivially testable.
- `CatAvatar`, `SpeechBubble`, `TabbyPanel` are pure presentational components — given props, render UI. No side effects.
- `intents.ts` and `quips.ts` are pure functions over inputs — unit-testable with no DOM.

---

## 4. Data flow

```
server broadcast ──► useWebSocket ──► eventBus.publish ──► useTabbyBrain subscriber
                                                                │
                          (reduce WSMessage + timers into state)│
                                                                ▼
                                            { mood, statusSummary, bubbleQueue }
                                                                │
                 ┌──────────────────────────────┬──────────────┴───────────────┐
                 ▼                                ▼                              ▼
            CatAvatar(mood)              SpeechBubble(next bubble)        TabbyPanel(statusSummary)
                                                                                │
                                                                  quick action  │  Ask
                                                                                ▼
                                                              useNavigate(route)  |  intents() → answer
                                                                                              | or → /run?prompt=
```

`useTabbyBrain` maintains a small in-memory model derived from the stream (it does not refetch):
- `liveCount` — active sessions/agents currently working.
- `errorCount` — sessions/agents in error since last clear.
- `lastEventAt` — timestamp of most recent `new_event`/update (drives `stuck`/`sleeping`).
- `connected` — from `eventBus.onConnection`.
- `recentDone` — transient flag set on a `session_updated` → status `completed`, cleared after the happy animation.

The exact `WSMessage.type` union the brain switches on (from `client/src/lib/types.ts`):
`session_created`, `session_updated`, `agent_created`, `agent_updated`, `new_event`,
`import.progress`, `update_status`, `run_stream`, `run_status`, `run_input_ack`, `cc_config_changed`.
Tabby only cares about: `session_created`/`session_updated`/`agent_created`/`agent_updated` (mood + counts),
`new_event` (activity heartbeat → `lastEventAt`, and hook-failure detection via the event payload),
`run_status` (run finished → `happy`). The rest are ignored.

These feed both the avatar mood and the panel's status line. Counts are best-effort from the stream; the panel may also read a one-shot from existing stats endpoints if needed for an accurate initial number (open item — see §10).

---

## 5. Mood state machine (rule-based brain)

Mood is a pure function of `(streamModel, timers)`, evaluated on every relevant event and on timer ticks. **Highest-priority matching state wins:**

| Priority | Mood | Trigger | Cat expression |
|---------:|------|---------|----------------|
| 1 | `disconnected` | WS down (`eventBus.connected === false`) | faded/desaturated, flat ears, still |
| 2 | `worried` | `session_updated`/`agent_updated` with status `error`, or a hook-failure `new_event` | arch + puff, ears back, brow down, brief shake |
| 3 | `stuck` | ≥1 live session AND `now - lastEventAt > STUCK_MS` | ears-up alert stare, `!` |
| 4 | `happy` | `session_updated` → `completed`, or `run_status` finished (transient, ~4s) | tail-up, eyes `^^`, head-bob |
| 5 | `thinking` | Ask in flight (panel) | head-tilt, `…` |
| 6 | `watching` | ≥1 live session, recent activity | eyes track cursor, ears up, tail flick |
| 7 | `sleeping` | no activity AND idle `> SLEEP_MS` | curled, eyes shut, `zzz` |
| 8 | `idle` | default / fallback | slow blink, gentle breathe |

Constants (tunable, defined in `useTabbyBrain`): `STUCK_MS` (~10 min), `SLEEP_MS` (~3 min). All timers cleared on unmount.

**Event → mood mapping (concrete):**
- `onConnection(true)` → recompute (leaves `disconnected`).
- `onConnection(false)` → `disconnected`.
- `session_updated` data.status `error` → `worried` (+ increment `errorCount`).
- `session_updated` data.status `completed` → `happy` (transient) + decrement `liveCount`.
- `session_created` / `session_updated` data.status `active` → `watching`, recompute `liveCount`.
- `agent_updated` status `error` → `worried`.
- `new_event` → refresh `lastEventAt`; hook-failure event types (confirm in build, see §10) → `worried`.
- `run_status` finished → `happy` (transient).
- (timers) inactivity → `stuck` (if live) or `sleeping` (if not).

---

## 6. Eyes & motion

- **Eye tracking (`watching`/`idle`):** pupils follow the mouse, clamped inside the eye socket via a small vector-normalize + clamp. Throttled (rAF or ~30ms) to stay cheap.
- **On event:** eyes glance toward the bubble, then relax back to tracking.
- **Ears/tail/body:** CSS keyframe animations in `tabby.css`, swapped by a `data-mood` attribute on the avatar root.
- **`prefers-reduced-motion`:** static eyes (centered), no breathe/shake/arch — mood still conveyed via static pose + face. Detected via `matchMedia`, passed as `reducedMotion` prop.

---

## 7. Auto-surface (speech bubbles)

- Pipeline: event → `quips.pick(mood/event)` → enqueue bubble → show ~4.5s → dismiss → settle.
- **Rate limit:** at most one bubble every few seconds; coalesce bursts ("3 sessions finished" instead of three bubbles).
- **Mute toggle:** persisted in `localStorage`. Muted = no bubbles, but faces/animations still react. Toggle lives in the panel.
- **Accessibility:** bubble container is `aria-live="polite"` so screen readers announce notable events without stealing focus.

Example quips (from `quips.ts`, randomized):
- happy: "session wrapped", "nice, that one's done", "4m12s — clean run"
- worried: "ow, an error", "a hook tripped — peek?"
- stuck: "this one's been quiet a while…", "still chewing on something?"
- sleeping: "zzz", "wake me if something happens"

---

## 8. Panel (click / ⌘B)

Opens as a small card anchored above the avatar. Themed with `surface-3`/`border`/`accent`.

**Status header:** ` N live · M errored · ●connected` (from brain's `statusSummary`; `●` reflects WS state, colored by health).

**Quick actions** (each = `useNavigate` to an existing route, or a local toggle):
- Jump to errored session → `/sessions/:id` (most recent error) or `/sessions?status=error`.
- Active sessions → `/sessions` (or `/activity`).
- **Run Claude** → `/run`.
- Activity feed → `/activity`.
- Mute / unmute bubbles (local toggle, persisted).
- Clear alerts (reset `errorCount`).

**Ask box:**
- P1/P2: `intents()` matches the query against a small set of local intents over cached status — e.g. *what's running*, *any errors*, *how many today*, *slowest* — and returns a templated answer rendered in the panel.
- Unmatched query → offer: "Ask Claude directly?" → opens `/run?prompt=<query>` (P3).

**Dismiss:** `Esc`, click-outside, or re-press `⌘B`.

---

## 9. Phasing

### P1 — Mascot (delight, zero backend)
- `CatAvatar.tsx` (full SVG + all moods + eye tracking + reduced-motion).
- `useTabbyBrain.ts` (eventBus subscription, mood machine, timers, bubble queue).
- `SpeechBubble.tsx`, `quips.ts`, `tabby.css`.
- `Tabby.tsx` container mounting avatar + bubble; `⌘B` reserved but panel stubbed.
- Mounted in `Layout.tsx`.
- **Outcome:** living, reacting cat in the corner with auto-bubbles. No panel yet.

### P2 — Panel (functional)
- `TabbyPanel.tsx`: status header + quick actions (router nav) + local Ask.
- `intents.ts` local intent matching.
- `localStorage` for `collapsed` + `muted`; mute/clear in panel.
- `Settings.tsx`: a single on/off toggle for Tabby (persisted), read by `Tabby.tsx`.
- **Outcome:** click/⌘B opens a useful panel; Ask answers from local data.

### P3 — "Do the job" handoff
- `Run.tsx`: read `?prompt=` search param → `setPrompt(prefill)` on mount (mirrors the existing `?session=` pattern). Client-only, no server change.
- Wire Ask's unmatched-query path → `/run?prompt=<query>`.
- **Outcome:** Tabby can hand a real question to a real `claude` subprocess via the existing Run flow.

---

## 10. Open items (resolve during planning/build)
1. **Accurate initial counts:** the stream gives deltas; on first mount counts are unknown until events arrive. Decide: (a) start at 0 and let the stream fill in (simplest), or (b) one-shot read from the existing stats endpoint for an accurate seed. Leaning (a) for P1, optional (b) in P2 panel.
2. **Hook-failure detection:** confirm which `event` `eventType` values represent hook failures vs. normal lifecycle, so `worried` only fires on real problems. Verify against `server/routes/hooks.js` + DB event types during build.
3. **Errored-session deep link:** confirm `/sessions` supports a `status=error` query or whether to navigate to the specific `/sessions/:id`.

---

## 11. Theme & accessibility notes
- Colors strictly from existing tokens: `surface-0..5`, `border`/`border-light`, `accent`/`accent-hover`. Cat palette: warm accent-tinted body that reads on the dark `surface-0` background; soft glow via `accent-muted`.
- Fonts inherit (`Inter` / `JetBrains Mono`) — bubble/status text uses existing classes.
- Keyboard: `⌘B`/`Ctrl+B` toggle, `Esc` close, panel actions tab-focusable.
- `prefers-reduced-motion`: disables continuous animation.
- z-index above content, below modals; never traps focus when collapsed.

---

## 12. Verification (per CLAUDE.md)
- **Frontend:** `npm run test:client`.
  - Unit tests for `useTabbyBrain` mood transitions (each event → expected mood, priority ordering, timer-driven `stuck`/`sleeping`).
  - Unit tests for `intents()` (known queries → templated answers; unknown → runHandoff).
  - Unit test for `quips.pick` (returns a string for every mood).
- **No server change in P1/P2** → `npm run test:server` not required for those phases. P3 touches only `Run.tsx` (client) → still client-only; run `test:client`.
- Manual: load dashboard, trigger a run, observe mood/bubble transitions; toggle reduced-motion; toggle mute; ⌘B/Esc.

---

## 13. File change summary
**New:** `client/src/components/Tabby/{Tabby,CatAvatar,SpeechBubble,TabbyPanel}.tsx`, `client/src/components/Tabby/{useTabbyBrain.ts,intents.ts,quips.ts,tabby.css}`, plus `__tests__` for brain/intents/quips.
**Edited:** `client/src/components/Layout.tsx` (mount, P1) · `client/src/pages/Settings.tsx` (on/off toggle, P2) · `client/src/pages/Run.tsx` (`?prompt=` prefill, P3) · i18n files (`tabby:*` keys, as strings are added).
