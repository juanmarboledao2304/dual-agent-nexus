/**
 * @file LegacyRedirect.test.tsx
 * @description Tests the v2 to v3 route redirects: `/kanban`, `/workflows`, and `/analytics`
 * land on `/rooms`, `/cascade-graph`, and `/quota-roi` with their query strings intact, and the
 * Kanban redirect pins the status-board layout.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { LegacyRedirect } from "../LegacyRedirect";

function Probe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="kanban"
          element={<LegacyRedirect to="/rooms" params={{ layout: "board" }} />}
        />
        <Route path="workflows" element={<LegacyRedirect to="/cascade-graph" />} />
        <Route path="analytics" element={<LegacyRedirect to="/quota-roi" />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("LegacyRedirect", () => {
  it("sends /kanban to the status board inside Agent Rooms", () => {
    renderAt("/kanban?view=sessions");
    expect(screen.getByTestId("location")).toHaveTextContent("/rooms?view=sessions&layout=board");
  });

  it("sends /workflows to the Cascade Hierarchy", () => {
    renderAt("/workflows");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/cascade-graph$/);
  });

  it("keeps analytics deep links working", () => {
    renderAt("/analytics?tab=cost");
    expect(screen.getByTestId("location")).toHaveTextContent("/quota-roi?tab=cost");
  });
});
