/**
 * @file TopNav.test.tsx
 * @description Tests for the top navigation: brand and mark, primary tab labels
 * and hrefs, compact icon-only mode, connection pill states, version label,
 * GitHub and Run agent links, and switching the UI language through the picker.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { beforeEach, describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { TopNav } from "../TopNav";
import i18n from "../../../i18n";

function renderNav(wsConnected: boolean, compact = false) {
  return render(
    <MemoryRouter>
      <TopNav wsConnected={wsConnected} compact={compact} />
    </MemoryRouter>
  );
}

describe("TopNav", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the brand name and the 8-bit app mark", () => {
    renderNav(true);
    expect(screen.getByText("DualAgent Nexus")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "DualAgent Nexus" }).length).toBeGreaterThan(0);
  });

  it("renders every primary tab with its short label and utility tabs as icons", () => {
    renderNav(true);
    for (const label of [
      "Overview",
      "World",
      "Rooms",
      "Sessions",
      "Activity",
      "Cascade",
      "Quota",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Config" })).toHaveAttribute("href", "/cc-config");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("links tabs, GitHub, and the Run agent action to the right destinations", () => {
    renderNav(true);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    for (const href of [
      "/",
      "/world",
      "/rooms",
      "/sessions",
      "/activity",
      "/cascade-graph",
      "/quota-roi",
      "/cc-config",
      "/settings",
      "/run",
      "https://github.com/juanmarboledao2304/dual-agent-nexus",
    ]) {
      expect(hrefs).toContain(href);
    }
    expect(hrefs).not.toContain("/kanban");
  });

  it("hides tab labels in compact mode but keeps accessible names", () => {
    renderNav(true, true);
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", "/sessions");
  });

  it('shows "Live" when the WebSocket is connected', () => {
    renderNav(true);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it('shows "Disconnected" when the WebSocket is not connected', () => {
    renderNav(false);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows the version number", () => {
    renderNav(true);
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it("opens the connection details modal from the status pill", async () => {
    const user = userEvent.setup();
    renderNav(true);
    await user.click(screen.getByRole("button", { name: "Connection details" }));
    expect(screen.getByText("WebSocket")).toBeInTheDocument();
  });

  it("exposes all five languages and switches to Spanish", async () => {
    const user = userEvent.setup();
    renderNav(true);

    const trigger = screen.getByRole("button", { name: "Language" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    const menu = screen.getByRole("listbox", { name: "Language" });
    expect(menu).toHaveClass("fixed");
    expect(screen.getByRole("option", { name: "Chinese 中文" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Vietnamese VI" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Korean 한국어" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Spanish ES" }));

    await waitFor(() => {
      expect(screen.getByText("Mundo")).toBeInTheDocument();
      expect(screen.getByText("Salas")).toBeInTheDocument();
    });
    await i18n.changeLanguage("en");
  });
});
