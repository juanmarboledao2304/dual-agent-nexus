/**
 * @file useAttention.test.ts
 * @description Unit tests for the strict "Needs you" rule (classifyAttention) and the quota helpers it
 * sits beside: approvals outrank everything, only recent errors count, working agents become "stalled"
 * after the idle threshold, finished agents never raise attention, and quota tones and labels format
 * as the top-bar meter shows them.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import { classifyAttention, STALL_MINUTES } from "../useAttention";
import { formatHours, formatTokens, quotaTone } from "../useQuotaTelemetry";
import type { Agent } from "../types";

const NOW = Date.parse("2026-10-20T12:00:00Z");

/** Minimal agent row; `minutesAgo` sets updated_at relative to NOW. */
function agent(
  id: string,
  status: Agent["status"],
  minutesAgo: number,
  extra: Partial<Agent> = {}
): Agent {
  return {
    id,
    session_id: `s-${id}`,
    name: id,
    type: "subagent",
    subagent_type: null,
    status,
    task: null,
    current_tool: null,
    started_at: new Date(NOW - 60 * 60000).toISOString(),
    ended_at: null,
    updated_at: new Date(NOW - minutesAgo * 60000).toISOString(),
    parent_agent_id: null,
    metadata: null,
    ...extra,
  } as Agent;
}

describe("classifyAttention", () => {
  it("flags approvals first, then recent errors, then stalled agents", () => {
    const items = classifyAttention(
      [
        agent("stalled", "working", STALL_MINUTES + 5),
        agent("err", "error", 3),
        agent("approve", "waiting", 1, { telemetry_status: "waiting_approval" } as Partial<Agent>),
      ],
      NOW
    );
    expect(items.map((i) => [i.agent.id, i.kind])).toEqual([
      ["approve", "approval"],
      ["err", "error"],
      ["stalled", "stalled"],
    ]);
  });

  it("ignores busy agents, old errors, and finished agents", () => {
    const items = classifyAttention(
      [
        agent("busy", "working", 1),
        agent("old-error", "error", 120),
        agent("done", "completed", 90),
      ],
      NOW
    );
    expect(items).toEqual([]);
  });

  it("reports how long a stalled agent has been quiet", () => {
    const [item] = classifyAttention([agent("quiet", "working", 42)], NOW);
    expect(item?.kind).toBe("stalled");
    expect(Math.round(item!.idleMinutes)).toBe(42);
  });
});

describe("quota helpers", () => {
  it("classifies remaining quota", () => {
    expect(quotaTone(0.5)).toBe("ok");
    expect(quotaTone(0.15)).toBe("low");
    expect(quotaTone(0.05)).toBe("critical");
  });

  it("formats tokens and hours compactly", () => {
    expect(formatTokens(709_900)).toBe("709.9K");
    expect(formatTokens(2_500_000)).toBe("2.50M");
    expect(formatHours(12.6)).toBe("12h 36m");
    expect(formatHours(0.5)).toBe("30m");
  });
});
