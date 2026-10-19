/**
 * @file agentTheme.phase2.test.ts
 * @description Unit tests for Phase 7 Chromatic Thermal UI (Pool 1 agy-claude Electric Fuchsia &
 * Neon Indigo, Pool 2 agy-gemini, Pool 3 claude-direct) and parseAgentMetadata helper.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect } from "vitest";
import {
  getAgentThermalTheme,
  formatAgentModelBadge,
  parseAgentMetadata,
  THERMAL_LEGEND_ITEMS,
} from "../agentTheme";

describe("Phase 7 — Chromatic Thermal UI & Pool 1 agy-claude Palette", () => {
  it("renders Pool 1 Heavy (Opus 5.5) in Electric Fuchsia (#d946ef) with [AGY • claude pool] pill", () => {
    const theme = getAgentThermalTheme({
      provider: "agy-claude",
      model: "claude-opus-5-5-thinking",
      model_tier: "heavy",
      effort: "high",
    });
    expect(theme.provider).toBe("agy-claude");
    expect(theme.providerPillLabel).toBe("AGY • claude pool");
    expect(theme.strokeHex).toBe("#d946ef");
    expect(theme.borderClass).toContain("border-fuchsia-500/50");
    expect(theme.spectrumLabel).toBe("Electric Fuchsia");
    expect(formatAgentModelBadge("claude-opus-5-5-thinking", "agy-claude", "heavy")).toBe(
      "Opus 5.5"
    );
  });

  it("renders Pool 1 Standard (Sonnet 5.5 / GPT-OSS 120B) in Neon Indigo (#6366f1)", () => {
    const theme = getAgentThermalTheme({
      provider: "agy-claude",
      model: "gpt-oss-120b-medium",
      model_tier: "standard",
      effort: "medium",
    });
    expect(theme.provider).toBe("agy-claude");
    expect(theme.strokeHex).toBe("#6366f1");
    expect(theme.borderClass).toContain("border-indigo-500/50");
    expect(theme.spectrumLabel).toBe("Neon Indigo");
    expect(formatAgentModelBadge("gpt-oss-120b-medium", "agy-claude", "standard")).toBe(
      "GPT-OSS 120B"
    );
  });

  it("includes all 8 thermal spectrum entries across Pool 1, Pool 2, and Pool 3", () => {
    expect(THERMAL_LEGEND_ITEMS.length).toBe(8);
    expect(THERMAL_LEGEND_ITEMS.some((i) => i.colorName === "Electric Fuchsia")).toBe(true);
    expect(THERMAL_LEGEND_ITEMS.some((i) => i.colorName === "Neon Indigo")).toBe(true);
  });

  it("normalizes ===DIGEST===, git checkpoints, and conversation_id in parseAgentMetadata", () => {
    const meta = parseAgentMetadata(
      JSON.stringify({
        hierarchy_level: 3,
        conversation_id: "conv_sec_01",
        digest_received: true,
        digest: {
          status: "SUCCESS",
          files_touched: ["server/routes/hooks.js"],
          key_findings: "All checks passed",
          offloaded_tokens_saved: 45200,
        },
        git_checkpoints: 3,
        git_checkpoint_commits: ["checkpoint: pre-agy-cascade"],
      })
    );
    expect(meta.hierarchy_level).toBe(3);
    expect(meta.conversation_id).toBe("conv_sec_01");
    expect(meta.digest_received).toBe(true);
    expect(meta.digest?.status).toBe("SUCCESS");
    expect(meta.digest?.offloaded_tokens_saved).toBe(45200);
    expect(meta.git_checkpoints).toBe(3);
    expect(meta.git_checkpoint_commits).toEqual(["checkpoint: pre-agy-cascade"]);
  });
});
