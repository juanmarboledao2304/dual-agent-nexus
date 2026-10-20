# Nexus Console redesign (2026-10-20)

**Goal:** turn the dashboard into a calm command center ("agent OS") for every AI agent the owner runs: as simple as possible while every piece of information stays reachable.

**Process:** screenshots of every v3.1 route; three concepts (Claude "Calm Ops Console", Claude "Live Mission Board", Antigravity Opus "Duet: two inks on carbon"); references (Linear 2026 refresh, Langfuse trace views, Vercel usage); owner decisions taken from a gallery of four rendered variants of the real app.

## Decisions (owner-approved)

| Topic | Decision |
| --- | --- |
| Navigation | Top bar, five labelled sections: **Command** (`/`), **Agents** (`/agents`), **Sessions** (`/sessions`), **Usage** (`/usage`), **Settings** (`/settings`) |
| Command | Answers first: Needs-you slips, Claude Direct fuel card (time to empty in Departure Mono, 8-bit meter, waterfall), Today, live agent tree, latest events |
| Agents | One page, views in `?mode=`: Tree (outline, `?style=graph` for SubagentGraph), Timeline (new), Board (status columns, replaced Rooms and Kanban), World |
| Floating chrome | Quota strip became the top-bar fuel gauge and popover; Command Center dock became the Launch panel (Run agent); Tabby off by default |
| Settings | Sections in `?section=`: dashboard (side menu, one section at a time), claude (CcConfig), health (SystemHealth) |
| Visual identity | Theme **Duet** (default) with **Console** as an alternative; CSS-variable tokens generated in OKLCH |

## Needs-you rule (`client/src/lib/useAttention.ts`)

Approval pending, pool out of quota (exit `10`), error in the last 30 minutes, the same tool 4+ times in a row, working with no event for 10+ minutes (stalled agents collapse into one slip), and Claude Direct under 20% of its 5-hour window. The bell, Command, and the Board share it.

## Tokens (`client/tailwind.config.js`)

Every colour is `rgb(var(--x) / <alpha-value>)`; a Tailwind plugin injects `:root` (console) and `:root[data-theme="duet"]`. Families: clay (Claude Direct), lilac (Antigravity Claude), glacier (Antigravity Gemini), mint (working), amber (waiting), coral (error), plus gray, surface 0-5, border, accent, paper. Legacy hues (violet, fuchsia, indigo, cyan, sky, blue, emerald, ...) are aliases of those families, so inherited pages restyle without class churn. Theme choice: `client/src/lib/theme.ts`, key `nexus-theme`.

## Follow-ups

- Inherited inner components (dispatcher, Settings sections, Analytics charts with hard-coded hex) still use mono uppercase labels in places; restyle them gradually.
- `agentTheme.ts` keeps hex strokes for the SVG graph; move them to theme variables if the Graph view needs Duet inks.
- Version bump (minor, `version-release` skill) when this ships.
