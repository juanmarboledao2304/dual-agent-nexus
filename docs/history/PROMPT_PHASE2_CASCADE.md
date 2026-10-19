cat << 'EOF' > PROMPT_PHASE2_CASCADE.md
# ROLE & OBJECTIVE
You are the Principal AI Systems Architect continuing work on **DualAgent Nexus**. Phase 1–6 compiled cleanly with 0 TypeScript errors and 169 passing tests.

Now, execute **Phase 7 (The `agy-cascade` 3-Pool Waterfall, Cross-CLI Bridge & Internal Fan-Out Upgrade)** by extending the exact files you just built (`modelClassifier.js`, `liveTranscriptWatcher.js`, `hooks.js`, `dispatchController.js`, `simulateController.js`, `agentTheme.ts`, `DualQuotaHeader.tsx`, `SubagentGraph.tsx`, `AgentInspectorDrawer.tsx`, `AgentCard.tsx`, and `CommandCenterDock.tsx`).

Do not break any existing tests or file authorship header checks. Ensure all 169+ tests and `npm run build` continue to pass.

---

# ARCHITECTURAL UPGRADES TO IMPLEMENT

## 1. THE 3-POOL QUOTA WATERFALL & `~/.cache/agy-cascade` WATCHER (`server/`)
Our real production workflow uses **`antigravity-for-claude-code (v0.28.0)`** and a custom waterfall wrapper **`agy-cascade`** that drains both Google AI Pro quota pools before touching direct Anthropic Claude Code tokens:
- **Pool 1: `agy-claude` (Google-paid Claude Pool in Antigravity):** `Claude Opus 5.5 (High -> Med)` -> `Claude Sonnet 5.5 (High)` -> `GPT-OSS 120B`.
- **Pool 2: `agy-gemini` (Google-paid Gemini Pool in Antigravity):** `Gemini 4+ / Argon (High)` -> `Gemini Pro` -> `Gemini 3.8 Flash (High -> Med -> Low)`.
- **Pool 3: `claude-direct` (Anthropic Direct Subscription):** Main Claude Code Conductor + native `Haiku` (`Explore`) subagents + final fallback when both Antigravity pools return exit code `10` (Quota Exhausted).

### Implementation in `server/`:
1. **Create `server/watchers/cascadeCacheWatcher.js` & `GET /api/cascade/status`:**
   - Monitor `~/.cache/agy-cascade/` in real time (handle missing directory gracefully without crashing):
     - Parse `~/.cache/agy-cascade/models.list` (if present) to expose the active model waterfall priority list (fallback to default cascade order: `Opus 5.5 High -> Opus 5.5 Med -> Sonnet 5.5 High -> GPT-OSS 120B -> Argon/Gemini 4 High -> Gemini Pro -> Gemini 3.8 Flash High -> Med -> Low`).
     - Detect `~/.cache/agy-cascade/claude.exhausted` and `~/.cache/agy-cascade/gemini.exhausted` files. Since `agy-cascade` marks a pool exhausted for **30 minutes** upon exit code `10`, read the file's `mtime` (modification timestamp), compute the exact remaining cooldown (`1800s - elapsed`), and broadcast live `cascade:status` updates via WebSockets.
2. **Track `===DIGEST===` Token Compression & Offload Savings (`modelClassifier.js` & `liveTranscriptWatcher.js`):**
   - Our skill enforces cost discipline: `agy-cascade` / `agy-delegate` must end outputs with a compact `===DIGEST===` summary instead of dumping massive logs into Claude Code's context window.
   - Detect `===DIGEST===` blocks in tool outputs/transcripts, extract the summary, and compute an **"Offloaded Tokens Saved"** metric (total tokens/bytes processed inside Antigravity vs. the tiny digest returned to Claude Code).

---

## 2. 3-LEVEL CROSS-CLI BRIDGE & INTERNAL FAN-OUT HIERARCHY (`server/` & `client/`)
In our single-terminal workflow, Claude Code acts as the **Conductor** and invokes Antigravity via `Bash` calls to `agy-cascade`, `agy-delegate`, `agy-job`, or `agy-trace`. Antigravity then performs an **Internal Fan-Out** using its native `define_subagent` and `invoke_subagent` tools (`TypeName: "self" | "research" | specialist`), outputting each child's `conversationId`.

### Implementation in `hooks.js`, `liveTranscriptWatcher.js`, and `SubagentGraph.tsx`:
1. **Level 1 -> Level 2 Bridge Detection (`Bash` -> `agy-cascade` / `agy-delegate`):**
   - When a Claude Code agent executes a `Bash` tool call containing `agy-cascade`, `agy-delegate`, or `agy-job` (e.g., `agy-cascade --dir . --yolo "<brief>"`), automatically create/link a **Level-2 Delegated Child Agent Node** under that Claude Conductor session!
   - Parse flags from the command (`--dir`, `--yolo`, `--digest`, `--timeout`, model/tier) and attach them to the node's metadata.
2. **Level 2 -> Level 3 Internal Fan-Out Detection (`define_subagent` & `invoke_subagent`):**
   - When Antigravity invokes `define_subagent` or `invoke_subagent` (or reports `conversationId` per unit in its output), spawn **Level-3 Specialist Child Nodes** branching directly off the Level-2 `agy-cascade` node in `SubagentGraph.tsx`.
3. **Git Checkpoint & `===DIGEST===` Badges (`AgentCard.tsx` & `AgentInspectorDrawer.tsx`):**
   - Display a **`===DIGEST===` Received** badge on completed delegated nodes (expandable inside `AgentInspectorDrawer.tsx` to read the clean digest).
   - Detect git commits (`git commit -m ...` or commit hashes in tool outputs) created during a delegation and show a **`Git Checkpoints: N`** badge on the card.

---

## 3. EXPAND `agentTheme.ts` WITH THE HYBRID "AGY-CLAUDE POOL" SPECTRUM (`client/src/utils/agentTheme.ts`)
Update `agentTheme.ts` and `modelClassifier.js` so the UI visually distinguishes all **3 Quota Pools**:
1. **Pool 3 — `claude-direct` (Anthropic Direct — Warm Spectrum):**
   - Heavy (`Opus` Conductor): Crimson Red (`#ef4444`)
   - Standard (`Sonnet`): Vibrant Orange (`#f97316`)
   - Light (`Haiku` / `Explore`): Amber Yellow (`#fbbf24`)
2. **Pool 1 — `agy-claude` (Claude Models Paid by Google Antigravity — Neon Magenta/Indigo Spectrum):**
   - Heavy (`Opus 5.5 High/Med` via `agy-cascade`): Electric Fuchsia (`#d946ef`, `border-fuchsia-500`, `bg-fuchsia-500/10`, `text-fuchsia-300`) with badge `[AGY • claude pool]`.
   - Standard (`Sonnet 5.5 High` / `GPT-OSS 120B` via `agy-cascade`): Neon Indigo (`#6366f1`, `border-indigo-500`, `bg-indigo-500/10`, `text-indigo-300`).
3. **Pool 2 — `agy-gemini` (Gemini/Argon Models Paid by Google Antigravity — Cool Spectrum):**
   - Heavy (`Gemini 4+ / Argon` / `Pro High`): Electric Purple (`#a855f7`)
   - Standard (`Gemini Pro` / Standard Flow): Cyber Blue (`#3b82f6`)
   - Light (`Gemini 3.8 Flash High/Med/Low` & Fan-Out Subagents): Emerald Green (`#10b981`)

---

## 4. UPGRADE `DualQuotaHeader.tsx`, `CommandCenterDock.tsx` & `simulateController.js`
1. **3-Pool Waterfall Status Bar in `DualQuotaHeader.tsx`:**
   - Add a sleek **Cascade Waterfall Bar** displaying the live flow:
     `[Pool 1: AGY-Claude (Opus 5.5 -> Sonnet 5.5)] [Pool 2: AGY-Gemini (Argon -> 3.8 Flash)] [Pool 3: Claude Direct]`
   - Show active/exhausted state per pool, live 30-minute cooldown countdown (`MM:SS`) if `claude.exhausted` or `gemini.exhausted` is active, and a **"Tokens Offloaded via `===DIGEST===`"** counter.
2. **New Execution Presets in `CommandCenterDock.tsx` & `dispatchController.js`:**
   Add two specialized orchestration modes to the Engine Selector in `CommandCenterDock.tsx`:
   - **` agy-cascade --yolo` (Waterfall Mode):** Executes `agy-cascade --dir <workspace> --yolo "<prompt>"` (with graceful simulated fallback if `agy-cascade` is not in PATH).
   - **` AGY Fan-Out Swarm (3x Subagents + Digest)`:** Wraps the user's task in the official `define_subagent` + `invoke_subagent` 3-unit fan-out recipe with `--yolo --digest --timeout 10m`.
3. **Upgrade `POST /api/simulate/swarm` (`simulateController.js`):**
   Make the ** Simulate Swarm** button showcase our real 3-level `agy-cascade` waterfall in a 25-second sequence:
   - **0s–4s:** Level-1 **Claude Conductor (Crimson Red)** writes the closed spec and runs `agy-cascade --dir . --yolo`.
   - **4s–10s:** Level-2 **`agy-cascade` Worker** starts on **AGY Claude Opus 5.5 High (Electric Fuchsia)**, then triggers a simulated **Exit Code 10 (`claude.exhausted` 30m cooldown!)**, flipping the header indicator and automatically cascading to **AGY Gemini 3.8 Flash High (Emerald/Blue)**.
   - **10s–20s:** The Level-2 node invokes `define_subagent` and `invoke_subagent`, fanning out **3 Level-3 Specialist Subagents** in parallel (`conversationId` nodes), logging per-unit git commit checkpoints.
   - **20s–25s:** Level-3 subagents complete, Level-2 compresses the output into a `===DIGEST===` block (incrementing the "Claude Quota Saved" counter), and Level-1 Claude Conductor runs `git diff` verification.

---

## 5. VERIFICATION & TESTS
- Preserve all required `@author Son Nguyen <hoangson091104@gmail.com>` file headers on every new or modified file so `server/__tests__/plugins-marketplace.test.js` passes 100%.
- Run `npm run typecheck:client`, `npm run build`, `npm --prefix client test -- --run`, and `node --test server/__tests__/plugins-marketplace.test.js` to confirm 0 errors.
EOF