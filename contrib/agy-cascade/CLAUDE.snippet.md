<!--
  DualAgent Nexus — Claude Code Instruction Snippet
  Append this block to your ~/.claude/CLAUDE.md or project CLAUDE.md.
-->

## DualAgent Nexus & agy-cascade Protocol

> **Model ladder (2026-11-20):** best-to-worst Gemini order is Carbon > Argon > **Neon** > Hydrogen
> (Neon = Opus-5.5-class, Hydrogen = Sonnet-5.5-class; `gemini-4-neon-*`, own lock `neon`).
>
> **Earlier note (2026-11-16):** the basic Gemini worker is **Gemini 4 Hydrogen**
> (`gemini-4-hydrogen-*`), which replaced Gemini 3.8 Flash. Hydrogen shares the general
> Gemini quota bag (with Pro/Flash); **Gemini 4 Argon** (`gemini-4-argon-*`) keeps its own
> separate weekly quota bag, so exhausting Argon never blocks Hydrogen. `agy-cascade`
> auto-orders from `agy models`, so Gemini 4 already outranks 3.8 Flash automatically.

When operating as the Conductor on this codebase:

1. **Heavy Work Delegation**:
   - For tasks involving complex refactoring, multi-file generation, test suite repairs, or parallel research, delegate to Google Antigravity via `agy-cascade`:
     ```bash
     agy-cascade --yolo --dir . "<clear, actionable instruction>"
     ```
   - Always run with `--dir <repo-path>` so Antigravity executes in the exact working directory.

2. **===DIGEST=== Output Discipline**:
   - Do NOT dump raw execution logs or lengthy transcripts back into the Claude context.
   - Demand that delegated subagents end their task with a structured `===DIGEST===` block:
     ```markdown
     ===DIGEST===
     - Status: SUCCESS | FAILURE
     - Files Touched: <comma-separated list>
     - Key Findings: <bulleted summary>
     - Follow-Ups: <recommended next steps>
     ```

3. **Git Checkpoint Protocol**:
   - Before launching external delegation or subagent swarms, checkpoint current progress:
     `git add -A && git commit -m "checkpoint: pre-delegation-<name>"`
   - Ensure every subagent produces exactly 1 commit per completed logical unit.
