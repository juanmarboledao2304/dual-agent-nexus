/**
 * @file CommandCenterDock.test.tsx
 * @description Tests the Command Center Dock's Quick Workflow Presets: each preset loads its
 * engine, model, effort, and prompt template for review without dispatching, presets are
 * reachable from the compact bar, and the dock renders no emoji.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandCenterDock, QUICK_PRESETS } from "../CommandCenterDock";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    cascade: { status: vi.fn(() => Promise.resolve({ active_pool: 1 })) },
    run: { cwds: vi.fn(() => Promise.resolve({ items: [] })) },
    dispatch: { start: vi.fn(), kill: vi.fn() },
  },
}));

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function renderDock() {
  return render(
    <MemoryRouter>
      <CommandCenterDock />
    </MemoryRouter>
  );
}

describe("CommandCenterDock quick presets", () => {
  it("offers the four workflow presets", () => {
    expect(QUICK_PRESETS.map((p) => p.label)).toEqual([
      "Spec + agy-cascade --yolo",
      "3-Unit Fan-Out + DIGEST",
      "Haiku Fast Explore",
      "Git Checkpoint + Diff Audit",
    ]);
  });

  it("loads a preset from the compact bar for review without dispatching", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Haiku Fast Explore" }));

    expect(screen.getByLabelText("Model Override")).toHaveValue("claude-haiku-4-5");
    const prompt = screen.getByPlaceholderText(/Dispatch via agy-cascade/) as HTMLTextAreaElement;
    expect(prompt.value).toMatch(/^Explore \(read-only/);
    expect(api.dispatch.start).not.toHaveBeenCalled();
  });

  it("switches engine and model together when a preset is applied", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: /3-Unit Fan-Out \+ DIGEST/ }));
    expect(screen.getByLabelText("Model Override")).toHaveValue("claude-opus-5-5-thinking");
    expect(screen.getByRole("button", { name: /3-Unit Fan-Out \+ DIGEST/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: /Git Checkpoint \+ Diff Audit/ }));
    expect(screen.getByLabelText("Model Override")).toHaveValue("claude-sonnet-4-6");
  });

  it("renders no emoji in either dock state", () => {
    const { container } = renderDock();
    expect(container.textContent ?? "").not.toMatch(EMOJI);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(container.textContent ?? "").not.toMatch(EMOJI);
  });
});
