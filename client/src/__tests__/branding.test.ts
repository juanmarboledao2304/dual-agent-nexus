/**
 * @file branding.test.ts
 * @description DualAgent Nexus branding guards: the favicon file matches the NexusMark pixel map,
 * `index.html` links it with the product title, and no client source file (tests excepted) ships
 * an emoji in UI copy, labels, or logs.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import NEXUS_ICON_FILE from "../../public/nexus-icon.svg?raw";
import INDEX_HTML from "../../index.html?raw";
import { NEXUS_MARK_SVG } from "../components/NexusMark";

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const SOURCES = import.meta.glob(["../**/*.{ts,tsx,css}", "!../**/__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("branding", () => {
  it("ships the 8-bit favicon generated from NexusMark", () => {
    const icon = NEXUS_ICON_FILE.trim();
    expect(icon).toBe(NEXUS_MARK_SVG);
    expect(icon).toContain('shape-rendering="crispEdges"');
    // Warm Claude half and cool Antigravity half.
    expect(icon).toContain("#ef4444");
    expect(icon).toContain("#a855f7");
    expect(icon).toContain("#22d3ee");
  });

  it("links the icon and product title in index.html", () => {
    const html = INDEX_HTML;
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/nexus-icon.svg" />');
    expect(html).toContain("<title>DualAgent Nexus | AI Orchestration &amp; Telemetry</title>");
  });

  it("keeps client source free of emoji", () => {
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => EMOJI.test(SOURCES[file] ?? ""));
    expect(offenders).toEqual([]);
  });
});
