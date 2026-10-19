/**
 * @file pixelSprites.test.ts
 * @description Unit tests for the 8-bit sprite engine data: every sprite is a well-formed 16x16
 * map whose pixel roles all have palette colors, pools and tiers resolve to the right sprite,
 * lifecycle maps to avatar states (approval only for blocking notifications), and tool names
 * compress to the geometric status badges.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { describe, expect, it } from "vitest";
import {
  SPRITE_DEFINITIONS,
  SPRITE_GRID,
  SPRITE_VARIANT_ORDER,
  avatarBadgeLabel,
  buildSpriteRects,
  isAwaitingApproval,
  resolveAvatarState,
  resolveSpriteVariant,
  toolBadgeLabel,
} from "../pixelSprites";
import type { PixelRole, SpriteVariant } from "../pixelSprites";

const VARIANTS = Object.keys(SPRITE_DEFINITIONS) as SpriteVariant[];

describe("sprite definitions", () => {
  it("ships all eight variants in the legend order", () => {
    expect(VARIANTS).toHaveLength(8);
    expect([...SPRITE_VARIANT_ORDER].sort()).toEqual([...VARIANTS].sort());
  });

  it.each(VARIANTS)("%s is a 16x16 grid of known pixel roles", (variant) => {
    const { rows, palette } = SPRITE_DEFINITIONS[variant];
    expect(rows).toHaveLength(SPRITE_GRID);
    for (const row of rows) {
      expect(row).toHaveLength(SPRITE_GRID);
      for (const ch of row) {
        if (ch === ".") continue;
        expect(palette[ch as PixelRole], `${variant} role ${ch} needs a color`).toBeTruthy();
      }
    }
  });

  it("uses the specified chassis colors per pool and tier", () => {
    expect(SPRITE_DEFINITIONS["claude-opus"].palette.B).toBe("#ef4444");
    expect(SPRITE_DEFINITIONS["claude-opus"].palette.A).toBe("#fbbf24");
    expect(SPRITE_DEFINITIONS["claude-sonnet"].palette.B).toBe("#f97316");
    expect(SPRITE_DEFINITIONS["claude-haiku"].palette.B).toBe("#eab308");
    expect(SPRITE_DEFINITIONS["agy-opus"].palette.B).toBe("#d946ef");
    expect(SPRITE_DEFINITIONS["agy-sonnet"].palette.B).toBe("#6366f1");
    expect(SPRITE_DEFINITIONS["gemini-argon"].palette.B).toBe("#a855f7");
    expect(SPRITE_DEFINITIONS["gemini-argon"].palette.C).toBe("#22d3ee");
    expect(SPRITE_DEFINITIONS["gemini-pro"].palette.B).toBe("#3b82f6");
    expect(SPRITE_DEFINITIONS["gemini-flash"].palette.B).toBe("#10b981");
  });

  it("gives Pool 1 sprites the orbital frame and Pool 2 sprites a core", () => {
    for (const v of ["agy-opus", "agy-sonnet"] as const) {
      expect(SPRITE_DEFINITIONS[v].rows.join("")).toContain("R");
    }
    for (const v of ["gemini-argon", "gemini-pro", "gemini-flash"] as const) {
      expect(SPRITE_DEFINITIONS[v].rows.join("")).toContain("C");
    }
  });

  it("merges rows into runs that cover exactly the opaque pixels", () => {
    for (const variant of VARIANTS) {
      const opaque = SPRITE_DEFINITIONS[variant].rows.join("").replace(/\./g, "").length;
      const covered = buildSpriteRects(variant).reduce((sum, r) => sum + r.width, 0);
      expect(covered, variant).toBe(opaque);
    }
  });
});

describe("resolveSpriteVariant", () => {
  it("maps each pool and tier to its character", () => {
    expect(resolveSpriteVariant("claude", "heavy")).toBe("claude-opus");
    expect(resolveSpriteVariant("claude", "standard")).toBe("claude-sonnet");
    expect(resolveSpriteVariant("claude", "light")).toBe("claude-haiku");
    expect(resolveSpriteVariant("agy-claude", "heavy")).toBe("agy-opus");
    expect(resolveSpriteVariant("agy-claude", "standard")).toBe("agy-sonnet");
    expect(resolveSpriteVariant("antigravity", "heavy")).toBe("gemini-argon");
    expect(resolveSpriteVariant("antigravity", "standard")).toBe("gemini-pro");
    expect(resolveSpriteVariant("agy-gemini", "light")).toBe("gemini-flash");
  });

  it("falls back to Claude Direct sprites for providers outside the waterfall", () => {
    expect(resolveSpriteVariant("codex", "standard")).toBe("claude-sonnet");
    expect(resolveSpriteVariant("cursor", "light")).toBe("claude-haiku");
  });
});

describe("resolveAvatarState", () => {
  it("covers the lifecycle", () => {
    expect(resolveAvatarState(null)).toBe("idle");
    expect(resolveAvatarState({ status: "working", current_tool: "Bash" })).toBe("working");
    expect(resolveAvatarState({ status: "working", current_tool: null })).toBe("thinking");
    expect(resolveAvatarState({ status: "working", telemetry_status: "thinking" })).toBe(
      "thinking"
    );
    expect(resolveAvatarState({ status: "completed" })).toBe("completed");
    expect(resolveAvatarState({ status: "error" })).toBe("error");
  });

  it("treats only blocking notifications as approval waits", () => {
    const since = "2026-10-19T10:00:00.000Z";
    expect(
      resolveAvatarState({
        status: "waiting",
        awaiting_input_since: since,
        awaiting_reason: "notification",
      })
    ).toBe("waiting_approval");
    // Idle between turns is not an approval prompt.
    expect(
      resolveAvatarState({
        status: "waiting",
        awaiting_input_since: since,
        awaiting_reason: "stop",
      })
    ).toBe("idle");
    expect(isAwaitingApproval({ status: "working", telemetry_status: "waiting_approval" })).toBe(
      true
    );
    expect(
      isAwaitingApproval({
        status: "completed",
        awaiting_input_since: since,
        awaiting_reason: "notification",
      })
    ).toBe(false);
  });
});

describe("badges", () => {
  it("compresses tool names to geometric badges", () => {
    expect(toolBadgeLabel("Bash")).toBe("BASH");
    expect(toolBadgeLabel("run_command")).toBe("BASH");
    expect(toolBadgeLabel("Read")).toBe("READ");
    expect(toolBadgeLabel("view_file_outline")).toBe("READ");
    expect(toolBadgeLabel("Edit")).toBe("EDIT");
    expect(toolBadgeLabel("replace_file_content")).toBe("EDIT");
    expect(toolBadgeLabel("Grep")).toBe("GREP");
    expect(toolBadgeLabel("Glob")).toBe("GREP");
    expect(toolBadgeLabel("invoke_subagent")).toBe("FAN-OUT");
    expect(toolBadgeLabel("Task")).toBe("FAN-OUT");
    expect(toolBadgeLabel("git commit")).toBe("GIT");
    expect(toolBadgeLabel("mcp__github__list_issues")).toBe("MCP");
    expect(toolBadgeLabel("SomeCustomTool")).toBe("SOMECUST");
    expect(toolBadgeLabel(null)).toBeNull();
  });

  it("labels each state", () => {
    expect(avatarBadgeLabel("working", "Edit")).toBe("EDIT");
    expect(avatarBadgeLabel("working", null)).toBe("WORKING");
    expect(avatarBadgeLabel("waiting_approval")).toBe("APPROVAL REQUIRED");
    expect(avatarBadgeLabel("completed", null, true)).toBe("DIGEST");
    expect(avatarBadgeLabel("completed", null, false)).toBe("DONE");
    expect(avatarBadgeLabel("error")).toBe("ERROR");
    expect(avatarBadgeLabel("thinking")).toBeNull();
    expect(avatarBadgeLabel("idle")).toBeNull();
  });
});
