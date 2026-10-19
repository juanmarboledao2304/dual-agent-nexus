/**
 * @file AgentRooms.test.tsx
 * @description Page test for Agent Rooms: the four zones render, a 3-level swarm lands in the
 * Conductor Bridge, Cascade Engine Room, Fan-Out Pods, and Digest Vault, pods show pool pills and
 * mini-terminal lines seeded from recent events, and the Attention Radar raises approval,
 * Exit Code 10, and tool-loop flags.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AgentRooms } from "../AgentRooms";
import type { Agent, DashboardEvent, Session } from "../../lib/types";

const SESSION = "swarm-claude-t1";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "x",
    session_id: SESSION,
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

const AGENTS: Agent[] = [
  agent({
    id: `${SESSION}-main`,
    type: "main",
    name: "Main Agent",
    status: "waiting",
    provider: "claude",
    model: "claude-opus-4-6",
    awaiting_input_since: "2026-10-19T10:00:12.000Z",
    awaiting_reason: "notification",
  }),
  agent({
    id: "bridge",
    name: "agy-cascade (Pool 2: Argon 4 Ultra)",
    parent_agent_id: `${SESSION}-main`,
    provider: "antigravity",
    model: "argon-4-ultra",
    current_tool: "define_subagent",
    metadata: JSON.stringify({
      hierarchy_level: 2,
      cascade_exit_code: 10,
      active_pool: "agy-gemini",
    }),
  }),
  agent({
    id: "haiku-2",
    name: "Explore: Grep WebSocket broadcast hooks",
    parent_agent_id: `${SESSION}-main`,
    provider: "claude",
    model: "claude-haiku-4-5",
    subagent_role: "Explore",
    current_tool: "Grep",
  }),
  agent({
    id: "unit-1",
    name: "Unit 1: Backend API",
    parent_agent_id: "bridge",
    provider: "antigravity",
    model: "gemini-3.8-flash-high",
    current_tool: "replace_file_content",
    metadata: JSON.stringify({ hierarchy_level: 3 }),
  }),
  agent({
    id: "unit-3",
    name: "Unit 3: Test Suite",
    parent_agent_id: "bridge",
    provider: "antigravity",
    model: "gemini-3.8-flash-high",
    status: "completed",
    ended_at: "2026-10-19T10:00:20.000Z",
    metadata: JSON.stringify({ hierarchy_level: 3, git_checkpoints: 1, digest_received: true }),
  }),
];

const EVENTS: DashboardEvent[] = [1, 2, 3, 4].map(
  (i) =>
    ({
      id: i,
      session_id: SESSION,
      agent_id: "haiku-2",
      event_type: "PreToolUse",
      tool_name: "Grep",
      summary: `Grep "broadcast\\(" server/ (attempt ${i})`,
      data: null,
      created_at: `2026-10-19T10:00:0${i}.000Z`,
    }) as DashboardEvent
);

const SESSIONS = [
  { id: SESSION, name: "Claude Conductor", status: "active", provider: "claude" } as Session,
];

vi.mock("../../lib/api", () => ({
  api: {
    agents: {
      list: vi.fn(({ status }: { status: string }) =>
        Promise.resolve({ agents: AGENTS.filter((a) => a.status === status) })
      ),
      kill: vi.fn(),
    },
    sessions: { list: vi.fn(() => Promise.resolve({ sessions: SESSIONS })) },
    events: { list: vi.fn(() => Promise.resolve({ events: [...EVENTS].reverse() })) },
  },
}));

function renderRooms() {
  return render(
    <MemoryRouter initialEntries={["/rooms"]}>
      <AgentRooms />
    </MemoryRouter>
  );
}

describe("AgentRooms", () => {
  it("renders the four operational zones", async () => {
    renderRooms();
    await screen.findByTestId("agent-rooms-grid");
    expect(screen.getByText("Conductor Bridge")).toBeInTheDocument();
    expect(screen.getByText("Cascade Engine Room")).toBeInTheDocument();
    expect(screen.getByText("Specialist Fan-Out Pods")).toBeInTheDocument();
    expect(screen.getByText("Completed Digest Vault")).toBeInTheDocument();
  });

  it("lays the swarm out by hierarchy level", async () => {
    renderRooms();
    await screen.findByTestId("agent-rooms-grid");
    const pods = (zone: string) =>
      within(screen.getByTestId(`zone-${zone}`))
        .queryAllByTestId("workstation-pod")
        .map((el) => el.getAttribute("data-agent-id"));
    expect(pods("conductor")).toEqual([`${SESSION}-main`]);
    expect(pods("engine").sort()).toEqual(["bridge", "haiku-2"]);
    expect(pods("fanout")).toEqual(["unit-1"]);
    expect(pods("vault")).toEqual(["unit-3"]);
  });

  it("shows pool pills, sprites, and seeded mini-terminal lines", async () => {
    renderRooms();
    await screen.findByTestId("agent-rooms-grid");
    expect(screen.getAllByText("[POOL 3 • CLAUDE DIRECT]").length).toBeGreaterThan(0);
    expect(screen.getAllByText("[POOL 2 • AGY-GEMINI]").length).toBeGreaterThan(0);
    const haikuPod = screen
      .getAllByTestId("workstation-pod")
      .find((el) => el.getAttribute("data-agent-id") === "haiku-2")!;
    expect(within(haikuPod).getByTestId("pixel-avatar")).toHaveAttribute(
      "data-variant",
      "claude-haiku"
    );
    await waitFor(() =>
      expect(within(haikuPod).getByTestId("pod-terminal")).toHaveTextContent("attempt 4")
    );
  });

  it("raises approval, Exit Code 10, and loop flags on the Attention Radar", async () => {
    renderRooms();
    await screen.findByTestId("agent-rooms-grid");
    await waitFor(() => expect(screen.getByText("LOOP GREP x4")).toBeInTheDocument());
    expect(screen.getByText("WAITING y/n")).toBeInTheDocument();
    expect(screen.getByText(/EXIT 10 QUOTA/)).toBeInTheDocument();
    const radar = screen.getByTestId("attention-radar");
    expect(radar).toHaveTextContent("APPROVAL 1");
    expect(radar).toHaveTextContent("EXIT 10 1");
    expect(radar).toHaveTextContent("LOOP 4+ 1");
  });
});
