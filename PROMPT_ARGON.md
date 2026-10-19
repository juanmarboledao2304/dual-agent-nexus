# ROLE & OBJECTIVE
You are a Staff AI Systems Architect, Principal Full-Stack Engineer, and UI/UX Design Lead specializing in Agentic IDE Internals (**Claude Code CLI** & **Google Antigravity IDE / `agy` CLI**).

You are operating inside a local clone of `Claude-Code-Agent-Monitor` (built with Node.js, Express, SQLite, WebSockets, React, Vite, and TailwindCSS). Your mission is to architect, refactor, and build **DualAgent Nexus**: the first open-source, real-time interactive Mission Control Dashboard, Subagent Graph Visualizer, and Unified Prompt Dispatcher that simultaneously monitors and controls both **Claude Code** and **Google Antigravity** subscriptions.

Execute this entire specification autonomously from Phase 1 to Phase 6. Do not stop at high-level plans—write the full, production-ready implementation across `server/`, `client/`, and `scripts/`, and verify that both backend and frontend build cleanly.

---

# ARCHITECTURAL SPECIFICATION & EXECUTION PHASES

## PHASE 1: Codebase Reconnaissance & Schema Audit
Before modifying files, inspect the repository structure:
1. Analyze `server/` (Express routes, WebSocket broadcast layer, SQLite schema, event ingestion).
2. Analyze `scripts/` (hook installers and payload forwarders).
3. Analyze `client/src/` (React components, state management, Kanban board, agent hierarchy views, token/cost charts, and prompt launcher).

---

## PHASE 2: Backend, SQLite Schema & Dual-Provider Telemetry Engine (`server/`)
Upgrade the backend data layer and event normalizer to treat **Claude Code** and **Google Antigravity** as first-class citizens with granular model and reasoning-effort tracking:

1. **Database & State Schema Expansion:**
   Ensure `sessions`, `agents` (including subagents), and `events` tables/models store:
   - `provider`: `'claude'` | `'antigravity'` | `'codex'` | `'cursor'`
   - `agent_id`: string (unique identifier per main agent or spawned subagent)
   - `parent_agent_id`: string | null (links child subagents to their parent orchestrator)
   - `subagent_role`: string (e.g., `'Main'`, `'Explore'`, `'Plan'`, `'Task'`, `'Verifier'`, `'Code'`, `'Browser'`, `'Custom'`)
   - `model`: string (raw model identifier, e.g., `'claude-opus-4-6'`, `'claude-sonnet-4-6'`, `'claude-haiku-4-5'`, `'gemini-3.8-flash'`, `'gemini-3-pro'`, `'argon-4'`)
   - `model_tier`: `'heavy'` | `'standard'` | `'light'`
   - `effort`: `'low'` | `'medium'` | `'high'` | `'max'` | `'auto'`
   - `status`: `'spawning'` | `'thinking'` | `'tool_use'` | `'waiting_approval'` | `'completed'` | `'error'`
   - `current_tool`: string | null (e.g., `'Bash'`, `'Read'`, `'Edit'`, `'Grep'`, `'Glob'`, `'WebSearch'`, `'MCP'`)
   - `metrics`: JSON/Columns tracking `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `context_utilization_pct`, `bytes_processed` (fallback for Antigravity local traces), and `burn_rate_per_hour`.

2. **Intelligent Model & Effort Classifier (`server/utils/modelClassifier.ts` or `.js`):**
   Build a deterministic parser that inspects incoming hook payloads and `.jsonl` transcript lines:
   - **Claude Code Rules:**
     - Models matching `opus` or explicit `effort: 'high' | 'max'` -> `model_tier: 'heavy'`.
     - Models matching `sonnet` or default main loop -> `model_tier: 'standard'`, default `effort: 'medium'`.
     - Models matching `haiku` OR subagents spawned via `Task` / `dispatch_agent` with `subagent_type: 'Explore'` -> `model_tier: 'light'`, default `effort: 'low'`.
   - **Google Antigravity Rules:**
     - Models matching `pro`, `ultra`, `argon`, or explicit `effort: 'high' | 'max'` -> `model_tier: 'heavy'`.
     - Standard coding/flow agents with `effort: 'medium'` -> `model_tier: 'standard'`.
     - Models matching `3.8-flash`, `flash`, `lite`, or background fast subagents with `effort: 'low'` -> `model_tier: 'light'`.

---

## PHASE 3: Non-Destructive Hook Installers & Live File Watchers (`scripts/` & `server/`)
Combine push-based lifecycle hooks with pull-based local transcript watchers for zero-latency updates:

1. **Unified Hook Installer (`scripts/install-hooks.js`):**
   - **Claude Code (`~/.claude/settings.json`):** Safely merge hooks for `SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, and `Stop` that POST event payloads to `http://127.0.0.1:7770/api/events?provider=claude`.
   - **Google Antigravity (`~/.gemini/config/hooks.json`):** Safely merge hooks for `PreToolUse`, `PostToolUse`, `SessionStart`, and `Stop` that POST event payloads to `http://127.0.0.1:7770/api/events?provider=antigravity`. Preserve all existing user hooks and MCP wrappers.

2. **Real-Time Transcript & Trace Watcher (`server/watchers/liveTranscriptWatcher.js`):**
   - Watch `~/.claude/projects/**/*.jsonl` in real time:
     - Detect whenever a parent session invokes the `Task` or `Agent` tool (`tool_use`) to spawn a child subagent. Extract `subagent_type`, `description`, `model`, `effort`, and token usage (`usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`).
   - Watch Antigravity local state/logs (`~/.gemini/` and active workspace `.gemini` / Antigravity session logs):
     - Parse active subagent spawns, assigned model (`3.8 Flash`, `Pro`, `Argon`), reasoning `effort`, and byte/token consumption.
   - Stream every state transition immediately to connected clients via WebSockets (`ws`).

---

## PHASE 4: Chromatic Thermal UI System & Live Subagent Graph (`client/src/`)
Redesign the React + TailwindCSS frontend into a sleek, high-contrast dark-mode Mission Control UI (`bg-slate-950`). Use an unmistakable **Warm vs. Cool Thermal Color Architecture** so the user can visually identify the provider, model tier, and reasoning effort at a glance:

1. **Centralized Theme Engine (`client/src/utils/agentTheme.ts` or `.js`):**
   - **CLAUDE CODE (WARM SPECTRUM):**
     - **Heavy Tier (`Opus` / `effort: high | max`):** Crimson Red
       - Classes: `bg-red-500/10 border-red-500/80 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.25)]`
       - Badge: `bg-red-500/20 text-red-300 border-red-500/40`
     - **Standard Tier (`Sonnet` / `effort: medium`):** Vibrant Orange
       - Classes: `bg-orange-500/10 border-orange-500/80 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.20)]`
       - Badge: `bg-orange-500/20 text-orange-300 border-orange-500/40`
     - **Light Tier (`Haiku` / `Explore` Subagent / `effort: low`):** Amber Yellow
       - Classes: `bg-amber-400/10 border-amber-400/80 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.20)]`
       - Badge: `bg-amber-400/20 text-amber-200 border-amber-400/40`
   - **GOOGLE ANTIGRAVITY (COOL SPECTRUM):**
     - **Heavy Tier (`Gemini Pro/Ultra` / `Argon` / `effort: high | max`):** Electric Purple / Violet
       - Classes: `bg-purple-600/10 border-purple-500/80 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.25)]`
       - Badge: `bg-purple-500/20 text-purple-200 border-purple-500/40`
     - **Standard Tier (`Standard Flow Agent` / `effort: medium`):** Cyber Blue
       - Classes: `bg-blue-500/10 border-blue-500/80 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.20)]`
       - Badge: `bg-blue-500/20 text-blue-200 border-blue-500/40`
     - **Light Tier (`Gemini 3.8 Flash` / Fast Subagent / `effort: low`):** Emerald Green
       - Classes: `bg-emerald-500/10 border-emerald-400/80 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.20)]`
       - Badge: `bg-emerald-500/20 text-emerald-200 border-emerald-400/40`

2. **Interactive Subagent Telemetry Cards & Hierarchy Graph:**
   - Every agent and subagent card (in both the **Kanban View** and the **Live Node Hierarchy Graph**) must display:
     - **Provider Pill:** Claude logo/badge (Warm) vs. Antigravity logo/badge (Cool).
     - **Model Badge:** Exact model shortname (e.g., `Opus 4.6`, `Sonnet 4.6`, `Haiku 4.5`, `Argon 4`, `Gemini 3 Pro`, `3.8 Flash`).
     - **Effort Meter:** Visual 4-bar signal indicator + label (`LOW`, `MED`, `HIGH`, `MAX`).
     - **Live Activity Pill:** Animated pulse indicator showing the currently executing tool (`Bash: npm test`, `Read: src/index.ts`, `Grep`, etc.) and elapsed time.
     - **Context & Token Bar:** Mini progress bar showing context window fill % and cache hit ratio.
   - In the **Live Subagent Graph**, draw animated SVG connector lines linking each Parent Orchestrator node to its spawned Child Subagent nodes in real time. Clicking any node opens a slide-over inspector showing its exact prompt, reasoning trace, tool call history, and live stdout.

---

## PHASE 5: Interactive Prompt Dispatcher & Process Manager (`client/` & `server/`)
Allow the user to write prompts, select models/effort levels, and dispatch tasks directly from the web dashboard without touching the terminal:

1. **Unified Command Center Dock (Frontend):**
   Create a persistent, collapsible command bar at the bottom of the dashboard featuring:
   - **Prompt Textarea:** Auto-expanding input supporting `Enter` to send and `Shift+Enter` for newline.
   - **Workspace Path Selector:** Input/dropdown for target project directory (`cwd`).
   - **Target Engine Selector:**
     - `Claude Code CLI`
     - `Antigravity CLI (agy)`
     - `Dual Swarm (Run Both in Parallel)` — dispatches the prompt to both engines simultaneously in the selected workspace.
   - **Model Override Dropdown:** Dynamically populated based on selected engine (e.g., `Auto`, `Opus`, `Sonnet`, `Haiku` for Claude; `Auto`, `Argon`, `Gemini Pro`, `3.8 Flash` for Antigravity).
   - **Reasoning Effort Selector:** `low` | `medium` | `high` | `max`.
   - **Live Stream Console & Kill Switch:** Stream the spawned CLI process stdout/stderr directly into the agent's card via WebSockets, and provide a `Stop / Kill (SIGTERM)` button on every active agent card.

2. **CLI Process Spawner (`server/controllers/dispatchController.js`):**
   - Implement `POST /api/dispatch` using `child_process.spawn`.
   - Construct safe CLI invocations for `claude` and `agy` / `antigravity` with the chosen working directory, model flag, and effort level.
   - Capture `stdout` and `stderr` streams line-by-line, associate the OS `pid` with a dashboard session card, and broadcast live output chunks over WebSockets.

---

## PHASE 6: Dual Subscription Quota Header & One-Click Swarm Simulator
1. **Top Dual-Subscription Telemetry Header:**
   Build a split status bar at the top of the UI:
   - **Left Wing (Claude Subscription - Warm Gradient):** Active 5-hour window token usage, Cache Hit Rate %, active Claude subagents count (broken down by Red/Orange/Yellow badges), and burn rate.
   - **Right Wing (Antigravity Subscription - Cool Gradient):** Active session quota/flow metrics, active Antigravity subagents count (broken down by Purple/Blue/Green badges), model distribution (`3.8 Flash` vs `Pro/Argon`), and burn rate.

2. **"Simulate Multi-Agent Swarm" Showcase Mode (Crucial for GitHub Demo & Testing):**
   - Add a prominent **" Simulate Swarm"** toggle button in the top navigation bar (and an API endpoint `POST /api/simulate/swarm`).
   - When clicked, simulate a realistic, multi-step 25-second orchestration across WebSockets:
     - Spawn a **Claude Opus (`effort: high`, Red)** orchestrator that delegates tasks to 1 **Claude Sonnet (`effort: medium`, Orange)** coder and 3 **Claude Haiku (`effort: low`, Yellow)** `Explore` subagents scanning files.
     - Simultaneously spawn an **Antigravity Argon (`effort: high`, Purple)** architect that delegates work to 1 **Standard Flow Agent (`effort: medium`, Blue)** and 3 **Gemini 3.8 Flash (`effort: low`, Emerald Green)** fast inspection subagents.
   - Animate their tool calls, token counters, and node connections in real time so any user (or GitHub visitor) can test the full visual spectrum immediately without spending real API quota.

3. **Build Verification & Viral Open-Source `README.md`:**
   - Run the build and linter across `server/` and `client/` to ensure zero compilation or runtime errors.
   - Rewrite `README.md` with clean badges, an architecture diagram, a thermal color legend table, 1-command setup instructions, and documentation on how Claude Code and Antigravity hooks work together.