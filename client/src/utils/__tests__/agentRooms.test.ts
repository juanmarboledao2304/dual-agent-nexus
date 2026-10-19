/**
 * @file agentRooms.test.ts
 * @description Unit tests for Agent Rooms layout and the Attention Radar: hierarchy levels, zone
 * assignment and ordering, bounded per-agent trace buffers, tool-loop detection, and the
 * approval / Exit Code 10 / loop / error flags.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import {
  LOOP_THRESHOLD,
  TRACE_CAPACITY,
  buildRoomLayout,
  createTraceStore,
  detectAttention,
  detectToolLoop,
  recordEventTrace,
  recordStreamTrace,
} from "../agentRooms";
import type { Agent } from "../../lib/types";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "a",
    session_id: "s1",
    name: "Agent",
    type: "subagent",
    subagent_type: null,
    status: "working",
    task: null,
    current_tool: null,
    started_at: "2026-10-19T10:00:00.000Z",
    ended_at: null,
    updated_at: "2026-10-19T10:00:00.000Z",
    parent_agent_id: null,
    metadata: null,
    ...overrides,
  } as Agent;
}

describe("buildRoomLayout", () => {
  const main = agent({ id: "s1-main", type: "main", name: "Main Agent" });
  const bridge = agent({ id: "bridge", parent_agent_id: "s1-main" });
  const unit = agent({ id: "unit-1", parent_agent_id: "bridge" });
  const explicitL3 = agent({ id: "unit-2", metadata: JSON.stringify({ hierarchy_level: 3 }) });
  const done = agent({
    id: "done",
    parent_agent_id: "bridge",
    status: "completed",
    ended_at: "2026-10-19T10:05:00.000Z",
  });
  const older = agent({
    id: "older",
    status: "completed",
    ended_at: "2026-10-19T10:01:00.000Z",
  });

  it("places agents by level and moves finished agents to the vault", () => {
    const { zones, levelById } = buildRoomLayout([main, bridge, unit, explicitL3, done, older]);
    expect(zones.conductor.map((a) => a.id)).toEqual(["s1-main"]);
    expect(zones.engine.map((a) => a.id)).toEqual(["bridge"]);
    expect(zones.fanout.map((a) => a.id).sort()).toEqual(["unit-1", "unit-2"]);
    expect(zones.vault.map((a) => a.id)).toEqual(["done", "older"]);
    expect(levelById.get("unit-1")).toBe(3);
    expect(levelById.get("done")).toBe(3);
  });

  it("keeps errored agents in their level's room", () => {
    const { zones } = buildRoomLayout([agent({ id: "e", status: "error" })]);
    expect(zones.engine.map((a) => a.id)).toEqual(["e"]);
    expect(zones.vault).toHaveLength(0);
  });

  it("lists working agents before waiting ones", () => {
    const waiting = agent({ id: "w", status: "waiting", updated_at: "2026-10-19T11:00:00.000Z" });
    const working = agent({ id: "k", status: "working" });
    expect(buildRoomLayout([waiting, working]).zones.engine.map((a) => a.id)).toEqual(["k", "w"]);
  });
});

describe("trace store", () => {
  it("records events, falls back to the session's main agent, and caps the buffer", () => {
    const store = createTraceStore();
    expect(
      recordEventTrace(
        store,
        {
          agent_id: null,
          event_type: "PreToolUse",
          tool_name: "Bash",
          summary: "npm test",
          created_at: "2026-10-19T10:00:00.000Z",
        },
        "s1-main"
      )
    ).toBe(true);
    expect(store.lines.get("s1-main")?.[0]).toMatchObject({ label: "BASH", text: "npm test" });
    expect(store.tools.get("s1-main")).toEqual(["Bash"]);

    for (let i = 0; i < TRACE_CAPACITY + 5; i += 1) {
      recordStreamTrace(store, "s1-main", `line ${i}`);
    }
    const lines = store.lines.get("s1-main") ?? [];
    expect(lines).toHaveLength(TRACE_CAPACITY);
    expect(lines[lines.length - 1]?.text).toBe(`line ${TRACE_CAPACITY + 4}`);
  });

  it("ignores blank output and unattributed events", () => {
    const store = createTraceStore();
    expect(recordStreamTrace(store, "a", "   ")).toBe(false);
    expect(recordStreamTrace(store, undefined, "text")).toBe(false);
    expect(
      recordEventTrace(store, {
        agent_id: null,
        event_type: "Stop",
        tool_name: null,
        summary: null,
        created_at: "2026-10-19T10:00:00.000Z",
      })
    ).toBe(false);
  });
});

describe("Attention Radar", () => {
  it("detects the same tool run four or more times in a row", () => {
    expect(detectToolLoop(["Grep", "Grep", "Grep"])).toBeNull();
    expect(detectToolLoop(["Read", "Grep", "Grep", "Grep", "Grep"])).toEqual({
      tool: "Grep",
      count: LOOP_THRESHOLD,
    });
    expect(detectToolLoop(["Grep", "Grep", "Grep", "Grep", "Read"])).toBeNull();
  });

  it("flags approvals, quota exhaustion, loops, and errors", () => {
    const approval = detectAttention(
      agent({
        status: "waiting",
        awaiting_input_since: "2026-10-19T10:00:00.000Z",
        awaiting_reason: "notification",
      })
    );
    expect(approval).toMatchObject({ approval: true, hasAttention: true });

    const idle = detectAttention(
      agent({
        status: "waiting",
        awaiting_input_since: "2026-10-19T10:00:00.000Z",
        awaiting_reason: "stop",
      })
    );
    expect(idle.hasAttention).toBe(false);

    const quota = detectAttention(agent({ metadata: JSON.stringify({ cascade_exit_code: 10 }) }));
    expect(quota.quotaExhausted).toBe(true);

    const loop = detectAttention(agent({}), ["Bash", "Bash", "Bash", "Bash"]);
    expect(loop.loop).toEqual({ tool: "Bash", count: 4 });

    expect(detectAttention(agent({ status: "error" })).error).toBe(true);
  });

  it("never flags finished agents", () => {
    const done = detectAttention(
      agent({ status: "completed", metadata: JSON.stringify({ cascade_exit_code: 10 }) }),
      ["Grep", "Grep", "Grep", "Grep"]
    );
    expect(done.hasAttention).toBe(false);
  });
});
