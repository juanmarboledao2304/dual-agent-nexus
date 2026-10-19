/**
 * @file AgentCard.tsx
 * @description Defines the AgentCard component that displays a summary of an
 * agent's name, status, task, current tool, timestamps, and latest-two-human-turn
 * context. Provider-owned main cards show the session's own title (clamped to
 * three lines) with the tool name leading the subtitle, so Claude Code, Cursor,
 * and Codex cards read the same. Cards reuse session task-progress donuts
 * beside status when available, and can render status as a dot where the
 * layout already names it (Kanban columns). Durable cards navigate to session
 * details while the brief pre-identity Codex process card stays non-navigable.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/components/AgentCard.tsx`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Internal dependencies
 * - `./StatusBadge`
 * - `../lib/types`
 * - `../lib/format`
 *
 * ## Public surface
 * - `AgentCard` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **AgentCard**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useTranslation } from "react-i18next";
import {
  Bot,
  GitBranch,
  Clock,
  Wrench,
  Cpu,
  Coins,
  Flame,
  Sparkles,
  Layers,
  ShieldCheck,
  GitCommit,
} from "lucide-react";
import { useNavigate } from "react-router";
import { AgentStatusBadge } from "./StatusBadge";
import { TodoProgressIndicator } from "./TodoProgressIndicator";
import { effectiveAgentStatus, isAgentAwaitingInput, agentAwaitingReason } from "../lib/types";
import type { Agent, Session } from "../lib/types";
import { formatDuration, timeAgo, formatModelName, pathBasename, fmtCost } from "../lib/format";
import { getAgentThermalTheme, parseAgentMetadata, sanitizeAgentText } from "../utils/agentTheme";

/** Keep a compact card's history legible: at most two distinct human turns,
 * one visual row each. This intentionally preserves a title-matching first
 * request when a terse follow-up depends on it for context.
 *
 * @param value - Stored prompt context, possibly empty.
 * @returns Up to two display lines.
 */
function promptPreviewLines(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      const key = line.toLocaleLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-2);
}

/** Props for {@link AgentCard}. */
interface AgentCardProps {
  /** Agent to show. */
  agent: Agent;
  /** Optional session data for richer main-agent rendering (model, cwd,
   *  cost). Subagent display ignores this. When omitted, the card falls
   *  back to the original minimal layout. */
  session?: Session;
  /** Subtitle override, shown in place of the subagent type. */
  label?: string;
  /** Click handler; defaults to opening the agent's session. */
  onClick?: () => void;
  /** `dot` shrinks the status badge to its colored dot (tooltip + screen-reader
   *  label kept) for surfaces where the layout already shows the status, such
   *  as a Kanban column. Defaults to the full badge. */
  statusDisplay?: "badge" | "dot";
}

/**
 * Whether a card is a transient placeholder for a Codex TUI process that has not written a session
 * id yet. Such cards are not clickable, since there is no session page to open.
 *
 * @param metadata - The row's JSON metadata.
 * @returns True when `pre_identity_process` is set.
 */
function isTransientProcessCard(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata)?.pre_identity_process === true;
  } catch {
    return false;
  }
}

/**
 * Kanban card for an agent: name, status badge, Chromatic Thermal encoding, 4-bar Effort Signal
 * Meter, context/token telemetry bar, and what it is working on. Main-agent cards use the
 * session for model, working directory, and cost; subagent cards show their type. Clicking opens
 * the session, except for transient Codex placeholders, which have no page yet.
 */
export function AgentCard({
  agent,
  session,
  label,
  onClick,
  statusDisplay = "badge",
}: AgentCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("kanban");
  const isWaiting = agent.status === "waiting" || isAgentAwaitingInput(agent);
  const status = effectiveAgentStatus(agent);
  const isActive = agent.status === "working";
  const isMain = agent.type === "main";

  // Resolve Chromatic Thermal UI theme (Warm Spectrum for Claude, Cool Spectrum for Antigravity)
  const theme = getAgentThermalTheme(agent, session?.provider, session?.model);
  const agentMeta = parseAgentMetadata(agent.metadata);

  // Session-level metadata applies to every card in the session - main and
  // subagents alike. Subtitle differs by type: main uses model+cwd (its
  // auto-generated name carries no info), subagents stick with their
  // subagent_type label (more useful than repeating the session model).
  const model = formatModelName(session?.model || agent.model);
  const cwdBase = pathBasename(session?.cwd);
  // Cost shown on the card is scoped to what the card represents: a main agent's
  // card stands in for the whole session, so it shows the session total; a
  // subagent's card shows that subagent's OWN cost (server-computed from its
  // token buckets).
  const cost = isMain
    ? typeof session?.cost === "number"
      ? session.cost
      : 0
    : typeof agent.cost === "number"
      ? agent.cost
      : 0;
  // Real (user-given) session name - auto-generated Claude/Codex fallbacks
  // carry no extra info next to the ID, so they are suppressed.
  const sessionName = session?.name?.trim() || "";
  const realSessionName = /^(Session [0-9a-f]{8}|Codex session)$/i.test(sessionName)
    ? ""
    : sessionName;
  const isCodexMain = isMain && session?.provider === "codex" && agent.name.trim() === "Codex";
  const isCursorMain = isMain && session?.provider === "cursor";
  const isAntigravityMain =
    isMain &&
    (session?.provider === "antigravity" || agent.provider === "antigravity") &&
    /^(Main Agent|Antigravity)/i.test(agent.name.trim());
  const isClaudeMain =
    isMain &&
    session?.provider !== "cursor" &&
    session?.provider !== "codex" &&
    session?.provider !== "antigravity" &&
    /^Main Agent(?:\s*-|$)/i.test(agent.name.trim());
  // Provider-owned main cards title themselves with the session's own title;
  // the tool name moves to the start of the subtitle instead of eating the
  // title row. Custom (non-placeholder) agent names and subagents keep their
  // agent name.
  const providerLabel = isCodexMain
    ? "Codex"
    : isCursorMain
      ? "Cursor"
      : isAntigravityMain
        ? "Antigravity"
        : isClaudeMain
          ? "Claude Code"
          : null;
  const rawDisplayName = providerLabel ? realSessionName || t("session.anonymous") : agent.name;
  const displayName = sanitizeAgentText(rawDisplayName);
  // Session titles and requests are intentionally independent: Claude,
  // Cursor, and Codex persist two recent real human turns on the session, while a
  // main-agent task remains the truthful fallback for pre-preview history.
  // Subagents keep their own assigned task instead of inheriting the parent.
  const taskPreview = isMain
    ? session?.prompt_preview?.trim() || agent.task?.trim() || null
    : agent.task?.trim() || null;
  const taskPreviewLines = promptPreviewLines(sanitizeAgentText(taskPreview));
  const isTransient = isTransientProcessCard(agent.metadata);
  // A subagent's own model lives in `agent.model` or its metadata (resolved from its transcript,
  // not the parent session's — see issue #185).
  let subagentModel: string | null = agent.model ? formatModelName(agent.model) : null;
  if (!isMain && !subagentModel && agent.metadata) {
    try {
      const parsed = JSON.parse(agent.metadata) as { model?: string };
      subagentModel = parsed?.model ? formatModelName(parsed.model) : null;
    } catch {
      subagentModel = null;
    }
  }
  // The model badge (footer) must reflect THIS card's agent: the session model
  // for main, the subagent's own model for subagents.
  const displayModel = isMain ? model : subagentModel;
  const agentCount = typeof session?.agent_count === "number" ? session.agent_count : 0;
  const subagentCount = Math.max(0, agentCount - 1);
  let sessionTurns = 0;
  if (isMain && session?.metadata) {
    try {
      const m = JSON.parse(session.metadata) as { turn_count?: number };
      if (typeof m?.turn_count === "number") sessionTurns = m.turn_count;
    } catch {
      sessionTurns = 0;
    }
  }
  const subtitle = isMain
    ? [
        providerLabel,
        cwdBase,
        subagentCount > 0 ? t("kanban:session.subagentSummary", { count: subagentCount }) : null,
        sessionTurns > 0 ? t("kanban:session.turnSummary", { count: sessionTurns }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : [label || agent.subagent_type, cwdBase].filter(Boolean).join(" · ") || null;

  const totalTokens = (agent.input_tokens ?? 0) + (agent.output_tokens ?? 0);
  const cacheReadTokens = agent.cache_read_tokens ?? 0;
  const cacheHitRatio =
    totalTokens + cacheReadTokens > 0
      ? Math.round((cacheReadTokens / (totalTokens + cacheReadTokens)) * 100)
      : 0;
  const contextPct = Math.min(100, Math.max(0, agent.context_utilization_pct ?? 0));

  function handleClick() {
    if (onClick) {
      onClick();
    } else if (!isTransient) {
      navigate(`/sessions/${agent.session_id}`);
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`card-hover p-4 overflow-hidden ${theme.bgGradientClass} ${
        isActive ? theme.glowClass : ""
      } ${isTransient ? "cursor-default" : "cursor-pointer"} ${
        isWaiting
          ? "border-l-2 border-l-yellow-500/60"
          : isActive
            ? `border-l-2 ${theme.borderClass}`
            : ""
      }`}
    >
      {/* Chromatic Thermal Header Strip: Provider Spectrum Pill + Tier Badge + 4-Bar Effort Meter */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${theme.providerPillClass}`}
          >
            {theme.provider === "claude" ? (
              <Flame className="w-2.5 h-2.5" />
            ) : (
              <Sparkles className="w-2.5 h-2.5" />
            )}
            {theme.provider === "agy-claude"
              ? "AGY • CLAUDE POOL"
              : theme.provider === "antigravity"
                ? "AGY · COOL"
                : "CLAUDE · WARM"}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold truncate ${theme.badgeClass}`}
          >
            {theme.label}
          </span>
        </div>

        {/* 4-Bar Effort Signal Meter (LOW, MED, HIGH, MAX) */}
        <div
          className="flex items-center gap-1 flex-shrink-0"
          title={`Reasoning Effort: ${theme.effortLabel}`}
        >
          <span className="flex items-end gap-0.5 h-2.5">
            {[1, 2, 3, 4].map((bar) => (
              <span
                key={bar}
                className={`w-0.5 rounded-sm transition-all ${
                  bar <= theme.effortBars ? theme.barActiveClass : "bg-slate-700/50"
                }`}
                style={{ height: `${bar * 25}%` }}
              />
            ))}
          </span>
          <span className="text-[9px] font-mono text-gray-400">{theme.effortLabel}</span>
        </div>
      </div>

      {/* ===DIGEST=== Handoff & Git Checkpoints Badges */}
      {(agentMeta.digest_received ||
        agentMeta.digest ||
        (agentMeta.git_checkpoints && agentMeta.git_checkpoints > 0)) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          {(agentMeta.digest_received || agentMeta.digest) && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/35">
              <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
              ===DIGEST=== Received
            </span>
          )}
          {agentMeta.git_checkpoints && agentMeta.git_checkpoints > 0 ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
              <GitCommit className="w-2.5 h-2.5 text-cyan-400" />
              Git Checkpoints: {agentMeta.git_checkpoints}
            </span>
          ) : null}
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-start gap-2.5 min-w-0 overflow-hidden">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${theme.badgeClass}`}
          >
            {isMain ? <Bot className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
          </div>
          <div className="min-w-0 overflow-hidden">
            {/* Wraps to at most three lines (long unbroken tokens such as
                paths break anywhere) so a long title never blows up the
                card; the full title stays available on hover. */}
            <p
              className="text-sm font-medium leading-snug text-gray-200 line-clamp-3 [overflow-wrap:anywhere]"
              title={displayName}
            >
              {displayName}
            </p>
            {/* Single line; the full subtitle (tool · project · counts) stays
                available on hover when the column is too narrow for it. */}
            {subtitle && (
              <p className="text-[11px] text-gray-500 truncate" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {/* compact: cards are narrow — inline reason chip would squeeze the
            title, so the reason stays hover-tooltip-only here. */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {session?.todo_summary && (
            <TodoProgressIndicator progress={session.todo_summary} stopClickPropagation />
          )}
          <AgentStatusBadge
            status={status}
            reason={agentAwaitingReason(agent)}
            provider={session?.provider}
            compact
            variant={statusDisplay}
          />
        </div>
      </div>

      {taskPreviewLines.length > 0 && (
        <div className={`mb-3 space-y-1 border-l-2 ${theme.borderClass} pl-2.5`}>
          {taskPreviewLines.map((prompt, index) => (
            <p
              key={`${index}-${prompt}`}
              className="text-xs text-gray-400 leading-relaxed line-clamp-1"
              title={prompt}
            >
              {prompt}
            </p>
          ))}
        </div>
      )}

      {/* Context Window Fill % & Token Telemetry Bar */}
      {(totalTokens > 0 || contextPct > 0) && (
        <div className="mb-3 space-y-1 bg-slate-950/50 p-2 rounded-lg border border-slate-800/70">
          <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
            <span className="flex items-center gap-1">
              <Layers className="w-2.5 h-2.5" />
              Ctx {contextPct.toFixed(0)}%
            </span>
            <span>
              {(totalTokens / 1000).toFixed(1)}K tok
              {cacheHitRatio > 0 ? ` · ${cacheHitRatio}% cache` : ""}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${theme.barActiveClass}`}
              style={{ width: `${Math.max(4, contextPct || Math.min(100, totalTokens / 2000))}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-500 min-w-0 overflow-hidden flex-wrap">
        {agent.current_tool && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Wrench className="w-3 h-3" />
            {agent.current_tool}
          </span>
        )}
        {/* Model badge - shown on every card when no tool is currently
            running (avoids clutter on actively-running agents that already
            display the running tool name). Uses the agent's OWN model:
            session model for main, the subagent's resolved model otherwise. */}
        {displayModel && !agent.current_tool && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Cpu className="w-3 h-3" />
            {displayModel}
          </span>
        )}
        {cost > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Coins className="w-3 h-3" />
            {fmtCost(cost)}
          </span>
        )}
        {agent.ended_at ? (
          <>
            <span className="flex items-center gap-1 flex-shrink-0">
              <Clock className="w-3 h-3" />
              {t("ran")}
              {formatDuration(agent.started_at, agent.ended_at)}
            </span>
            <span className="text-gray-600 flex-shrink-0">{timeAgo(agent.ended_at)}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" />
            {timeAgo(agent.last_activity || agent.updated_at || agent.started_at)}
          </span>
        )}
        {/* Main cards already carry the session title as their own title, so
            the footer keeps only the short ID; a subagent card's title is the
            subagent, so its session name stays here as context. */}
        <span className="ml-auto flex items-center gap-1 min-w-0 opacity-50">
          {realSessionName && !providerLabel && (
            <span className="truncate max-w-[10rem]" title={realSessionName}>
              {realSessionName} ·
            </span>
          )}
          <span className="font-mono flex-shrink-0">{agent.session_id.slice(0, 8)}</span>
        </span>
      </div>
    </div>
  );
}
