/**
 * @file AgentWorld.test.tsx
 * @description Tests for the Agent World page with a mocked API and no 2D canvas
 * (jsdom): the page and side panel render, sandbox agents can be created,
 * paused, resumed, and deleted from the panel, and live agents stay read-only
 * (inspector only, no pause/delete controls).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import i18n from "../../i18n";
import type { Agent } from "../../lib/types";

const liveAgent = {
  id: "live-1",
  session_id: "s1",
  name: "Conductor Main",
  type: "main",
  subagent_type: null,
  status: "working",
  task: "Refactor the hook pipeline",
  current_tool: "Bash",
  started_at: "2026-10-19T00:00:00.000Z",
  ended_at: null,
  updated_at: "2026-10-19T00:00:00.000Z",
  parent_agent_id: null,
  metadata: null,
} as unknown as Agent;

vi.mock("../../lib/api", () => ({
  api: {
    agents: {
      list: vi.fn((params: { status?: string }) =>
        Promise.resolve({ agents: params.status === "working" ? [liveAgent] : [] })
      ),
    },
    sessions: { list: vi.fn(() => Promise.resolve({ sessions: [] })) },
  },
}));

vi.mock("../../components/AgentInspectorDrawer", () => ({
  AgentInspectorDrawer: ({ agent }: { agent: Agent | null }) =>
    agent ? <div data-testid="inspector">{agent.name}</div> : null,
}));

import { AgentWorld } from "../AgentWorld";

function renderPage() {
  return render(
    <MemoryRouter>
      <AgentWorld />
    </MemoryRouter>
  );
}

describe("AgentWorld", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("en");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the title, the map, and both panel tabs", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Agent World" })).toBeInTheDocument();
    expect(screen.getByRole("application", { name: "Agent World map" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Live/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Sandbox/ })).toBeInTheDocument();
    expect(await screen.findByText("Conductor Main")).toBeInTheDocument();
  });

  it("keeps live agents read-only and opens the inspector", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Conductor Main/ }));
    expect(screen.getByText(/read-only here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open inspector" }));
    expect(screen.getByTestId("inspector")).toHaveTextContent("Conductor Main");
  });

  it("creates, pauses, resumes, and deletes a sandbox agent", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "New sandbox agent" }));
    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByRole("textbox", { name: "Name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Scout");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Scout/ })).toBeInTheDocument());
    expect(screen.getByText("1 live · 1 sandbox", { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Scout/ })).not.toBeInTheDocument()
    );
    expect(screen.getByText("Select an agent on the map or in the list.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("nexus-world-sandbox-v1") ?? "[]")).toEqual([]);
  });
});
