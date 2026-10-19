/**
 * @file PixelAvatar.test.tsx
 * @description Component tests for the 8-bit PixelAvatar: crisp-edged SVG output, pool/tier
 * sprite resolution from an agent row, and the state indicators (thinking dots, tool badge,
 * approval frame and badge, digest badge).
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PixelAvatar } from "../PixelAvatar";
import type { Agent } from "../../lib/types";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "a1",
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

describe("PixelAvatar", () => {
  it("renders a crisp-edged 16x16 SVG sprite", () => {
    const { container } = render(<PixelAvatar variant="claude-opus" state="idle" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(10);
  });

  it("resolves the sprite from the agent's pool and tier", () => {
    const { rerender } = render(
      <PixelAvatar agent={agent({ provider: "agy-claude", model: "claude-opus-5-5-thinking" })} />
    );
    expect(screen.getByTestId("pixel-avatar")).toHaveAttribute("data-variant", "agy-opus");

    rerender(<PixelAvatar agent={agent({ provider: "antigravity", model: "argon-4-ultra" })} />);
    expect(screen.getByTestId("pixel-avatar")).toHaveAttribute("data-variant", "gemini-argon");

    rerender(
      <PixelAvatar agent={agent({ provider: "antigravity", model: "gemini-3.8-flash-high" })} />
    );
    expect(screen.getByTestId("pixel-avatar")).toHaveAttribute("data-variant", "gemini-flash");

    rerender(<PixelAvatar agent={agent({ provider: "claude", model: "claude-haiku-4-5" })} />);
    expect(screen.getByTestId("pixel-avatar")).toHaveAttribute("data-variant", "claude-haiku");
  });

  it("shows three pixel dots while thinking", () => {
    const { container } = render(<PixelAvatar agent={agent({ current_tool: null })} />);
    expect(screen.getByTestId("pixel-avatar")).toHaveAttribute("data-state", "thinking");
    expect(container.querySelectorAll(".pixel-dot")).toHaveLength(3);
    expect(container.querySelector(".pixel-bob")).not.toBeNull();
  });

  it("badges the active tool while working", () => {
    render(<PixelAvatar agent={agent({ current_tool: "Bash" })} />);
    expect(screen.getByText("BASH")).toBeInTheDocument();
  });

  it("frames and badges approval waits", () => {
    const { container } = render(
      <PixelAvatar
        agent={agent({
          status: "waiting",
          awaiting_input_since: "2026-10-19T10:00:00.000Z",
          awaiting_reason: "notification",
        })}
      />
    );
    expect(screen.getByText("APPROVAL REQUIRED")).toBeInTheDocument();
    expect(container.querySelector(".pixel-frame-approval")).not.toBeNull();
  });

  it("shows the DIGEST badge on completed agents that returned a digest", () => {
    const { container } = render(
      <PixelAvatar
        agent={agent({
          status: "completed",
          metadata: JSON.stringify({ digest_received: true, digest: "SUCCESS" }),
        })}
      />
    );
    expect(screen.getByText("DIGEST")).toBeInTheDocument();
    expect(container.querySelector(".pixel-frame-completed")).not.toBeNull();
  });

  it("can render as a bare inline icon", () => {
    const { container } = render(
      <PixelAvatar
        variant="gemini-pro"
        state="working"
        framed={false}
        indicator={false}
        showBadge={false}
      />
    );
    expect(container.querySelector(".pixel-frame-working")).toBeNull();
    expect(container.querySelector(".pixel-dot")).toBeNull();
    expect(screen.queryByText("WORKING")).toBeNull();
  });
});
