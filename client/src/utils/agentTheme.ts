/**
 * @file Chromatic Thermal UI System for DualAgent Nexus.
 * Maps Claude Code (Warm Spectrum: Red/Orange/Yellow) and Google Antigravity (Cool Spectrum: Purple/Blue/Emerald)
 * agents to deterministic Tailwind classes, SVG connector stroke colors, model badges, and 4-bar effort meters.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

export type ThermalProvider = "claude" | "agy-claude" | "antigravity" | "codex" | "cursor";
export type ModelTier = "heavy" | "standard" | "light";
export type ReasoningEffort = "low" | "medium" | "high" | "max";
export type SubagentRole =
  | "Main"
  | "Explore"
  | "Plan"
  | "Task"
  | "Verifier"
  | "Code"
  | "Browser"
  | "Custom";

export interface AgentThermalTheme {
  provider: ThermalProvider;
  providerLabel: string;
  providerPillLabel: string;
  tier: ModelTier;
  tierLabel: string;
  label: string;
  effort: ReasoningEffort;
  effortLabel: "LOW" | "MED" | "HIGH" | "MAX";
  effortBars: 1 | 2 | 3 | 4;
  role: SubagentRole;
  modelShortName: string;
  cardClass: string;
  borderClass: string;
  bgGradientClass: string;
  glowClass: string;
  badgeClass: string;
  providerPillClass: string;
  dotColorClass: string;
  dotClass: string;
  barFillClass: string;
  barActiveClass: string;
  strokeHex: string;
  svgStroke: string;
  glowHex: string;
  spectrumLabel: string;
}

export interface ThermalLegendItem {
  provider: "claude" | "agy-claude" | "antigravity";
  tier: ModelTier;
  colorName: string;
  hex: string;
  models: string;
  role: string;
}

export const THERMAL_LEGEND_ITEMS: ThermalLegendItem[] = [
  {
    provider: "claude",
    tier: "heavy",
    colorName: "Crimson Red",
    hex: "#ef4444",
    models: "Claude Opus 4.6 · High/Max Effort",
    role: "Pool 3: Direct Conductor / Architect",
  },
  {
    provider: "claude",
    tier: "standard",
    colorName: "Vibrant Orange",
    hex: "#f97316",
    models: "Claude Sonnet 4.6 · Med Effort",
    role: "Pool 3: Direct Standard Execution",
  },
  {
    provider: "claude",
    tier: "light",
    colorName: "Amber Yellow",
    hex: "#fbbf24",
    models: "Claude Haiku 4.5 · Low Effort",
    role: "Pool 3: Fast Recon / Explore Subagent",
  },
  {
    provider: "agy-claude",
    tier: "heavy",
    colorName: "Electric Fuchsia",
    hex: "#d946ef",
    models: "Opus 5.5 High/Med (AGY • claude pool)",
    role: "Pool 1: Waterfall Primary Heavy",
  },
  {
    provider: "agy-claude",
    tier: "standard",
    colorName: "Neon Indigo",
    hex: "#6366f1",
    models: "Sonnet 5.5 High / GPT-OSS 120B",
    role: "Pool 1: Waterfall Standard",
  },
  {
    provider: "antigravity",
    tier: "heavy",
    colorName: "Electric Purple",
    hex: "#a855f7",
    models: "Argon 4 Ultra / Gemini 4+ High",
    role: "Pool 2: Deep Reasoning / Planner",
  },
  {
    provider: "antigravity",
    tier: "standard",
    colorName: "Cyber Blue",
    hex: "#3b82f6",
    models: "Gemini 3 Pro / Flow · Med Effort",
    role: "Pool 2: Standard Agentic Coding Flow",
  },
  {
    provider: "antigravity",
    tier: "light",
    colorName: "Emerald Green",
    hex: "#10b981",
    models: "Gemini 3.8 Flash · High/Med/Low",
    role: "Pool 2: High-Speed Fan-Out Specialist",
  },
];

export interface AgentDigestPayload {
  raw?: string;
  status?: string;
  files_touched?: string[];
  key_findings?: string;
  follow_ups?: string;
  offloaded_tokens_saved?: number;
}

export interface ParsedAgentMetadata {
  hierarchy_level?: number;
  bridge_tool?: string;
  conversation_id?: string;
  digest?: AgentDigestPayload;
  digest_received?: boolean;
  offloaded_tokens_saved?: number;
  git_checkpoints?: number;
  git_commits?: string[];
  git_checkpoint_commits?: string[];
  cascade_exit_code?: number;
  pool_cascaded?: boolean;
  exhausted_pool?: string;
  active_pool?: string;
  yolo?: boolean;
  timeout?: string;
  workspace_dir?: string;
}

/**
 * Parse agent metadata JSON safely for ===DIGEST===, git checkpoints, and 3-level hierarchy attributes.
 */
export function parseAgentMetadata(
  rawMetadata?: string | Record<string, unknown> | null
): ParsedAgentMetadata {
  if (!rawMetadata) return {};
  let obj: Record<string, unknown> = {};
  if (typeof rawMetadata === "object") {
    obj = rawMetadata;
  } else {
    try {
      const parsed = JSON.parse(rawMetadata);
      if (parsed && typeof parsed === "object") {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  let normalizedDigest: AgentDigestPayload | undefined;
  if (typeof obj.digest === "string" && obj.digest.trim()) {
    normalizedDigest = {
      raw: obj.digest,
      offloaded_tokens_saved:
        typeof obj.offloaded_tokens_saved === "number" ? obj.offloaded_tokens_saved : undefined,
    };
  } else if (obj.digest && typeof obj.digest === "object") {
    normalizedDigest = obj.digest as AgentDigestPayload;
  }

  const commits = Array.isArray(obj.git_checkpoint_commits)
    ? (obj.git_checkpoint_commits as string[])
    : Array.isArray(obj.git_commits)
      ? (obj.git_commits as string[])
      : undefined;

  return {
    ...(obj as ParsedAgentMetadata),
    digest: normalizedDigest,
    git_checkpoint_commits: commits,
  };
}

/**
 * Resolve provider from explicit provider, model, or name.
 */
export function resolveProvider(
  provider?: string | null,
  model?: string | null,
  name?: string | null
): ThermalProvider {
  const p = String(provider || "")
    .toLowerCase()
    .trim();
  const m = String(model || "")
    .toLowerCase()
    .trim();
  const n = String(name || "")
    .toLowerCase()
    .trim();

  if (
    p === "agy-claude" ||
    m.includes("opus-5") ||
    m.includes("opus 5") ||
    m.includes("sonnet-5") ||
    m.includes("sonnet 5") ||
    m.includes("gpt-oss") ||
    m.includes("120b") ||
    ((p === "antigravity" || p === "agy" || n.includes("agy-cascade")) &&
      (m.includes("opus") || m.includes("sonnet")))
  ) {
    return "agy-claude";
  }

  if (
    p === "antigravity" ||
    p === "agy-gemini" ||
    p === "agy" ||
    p === "gemini" ||
    m.includes("gemini") ||
    m.includes("argon") ||
    m.includes("3.8-flash") ||
    m.includes("flash") ||
    n.includes("antigravity") ||
    n.includes("argon") ||
    n.includes("3.8 flash")
  ) {
    return "antigravity";
  }
  if (p === "codex" || m.includes("gpt-5") || m.includes("codex")) return "codex";
  if (p === "cursor") return "cursor";
  return "claude";
}

/**
 * Deterministically resolve model tier from explicit tier, model name, effort, or subagent role.
 */
export function resolveModelTier(params: {
  provider: ThermalProvider;
  modelTier?: string | null;
  model?: string | null;
  effort?: string | null;
  subagentType?: string | null;
  subagentRole?: string | null;
}): ModelTier {
  const explicit = String(params.modelTier || "")
    .toLowerCase()
    .trim();
  if (explicit === "heavy" || explicit === "standard" || explicit === "light") {
    return explicit;
  }

  const m = String(params.model || "").toLowerCase();
  const e = String(params.effort || "").toLowerCase();
  const sub = String(params.subagentRole || params.subagentType || "").toLowerCase();

  if (params.provider === "agy-claude") {
    if (m.includes("opus")) return "heavy";
    return "standard";
  }

  if (params.provider === "antigravity") {
    if (m.includes("3.8-flash") || m.includes("flash") || m.includes("lite") || e === "low") {
      return "light";
    }
    if (
      m.includes("pro") ||
      m.includes("ultra") ||
      m.includes("argon") ||
      e === "high" ||
      e === "max"
    ) {
      return "heavy";
    }
    return "standard";
  }

  // Claude Code / default
  if (m.includes("haiku") || sub.includes("explore") || e === "low") {
    return "light";
  }
  if (m.includes("opus") || e === "high" || e === "max") {
    return "heavy";
  }
  return "standard";
}

/**
 * Resolve reasoning effort and 4-bar meter count.
 */
export function resolveEffort(
  effort?: string | null,
  tier: ModelTier = "standard"
): {
  effort: ReasoningEffort;
  effortLabel: "LOW" | "MED" | "HIGH" | "MAX";
  effortBars: 1 | 2 | 3 | 4;
} {
  const e = String(effort || "")
    .toLowerCase()
    .trim();
  if (e === "max" || e === "maximum" || e === "xhigh") {
    return { effort: "max", effortLabel: "MAX", effortBars: 4 };
  }
  if (e === "high") {
    return { effort: "high", effortLabel: "HIGH", effortBars: 3 };
  }
  if (e === "medium" || e === "med") {
    return { effort: "medium", effortLabel: "MED", effortBars: 2 };
  }
  if (e === "low") {
    return { effort: "low", effortLabel: "LOW", effortBars: 1 };
  }

  if (tier === "heavy") return { effort: "high", effortLabel: "HIGH", effortBars: 3 };
  if (tier === "light") return { effort: "low", effortLabel: "LOW", effortBars: 1 };
  return { effort: "medium", effortLabel: "MED", effortBars: 2 };
}

/**
 * Format compact model badge text (e.g. Opus 5.5, Sonnet 5.5, GPT-OSS 120B, Opus 4.6, Sonnet 4.6, Haiku 4.5, Argon 4, 3.8 Flash).
 */
export function formatModelBadge(
  model?: string | null,
  provider: ThermalProvider | string = "claude",
  tier: ModelTier = "standard"
): string {
  const m = String(model || "")
    .toLowerCase()
    .trim();

  if (provider === "agy-claude") {
    if (m.includes("gpt-oss") || m.includes("120b")) return "GPT-OSS 120B";
    if (m.includes("opus")) return "Opus 5.5";
    if (m.includes("sonnet")) return "Sonnet 5.5";
    return tier === "heavy" ? "Opus 5.5" : "Sonnet 5.5";
  }

  if (provider === "antigravity" || provider === "agy-gemini") {
    if (m.includes("argon")) return "Argon 4";
    if (m.includes("gemini-4") || m.includes("gemini 4")) return "Gemini 4";
    if (m.includes("ultra")) return "Gemini Ultra";
    if (m.includes("3.8-flash") || m.includes("3.8")) return "3.8 Flash";
    if (m.includes("flash-lite") || m.includes("lite")) return "Flash Lite";
    if (m.includes("flash")) return "3.8 Flash";
    if (m.includes("pro")) return "Gemini 3 Pro";
    if (m.includes("flow")) return "Agy Flow";
    if (tier === "heavy") return "Argon 4";
    if (tier === "light") return "3.8 Flash";
    return "Gemini 3 Flow";
  }

  if (m.includes("opus")) {
    if (m.includes("5-5") || m.includes("5.5")) return "Opus 5.5";
    if (m.includes("4-5") || m.includes("4.5")) return "Opus 4.5";
    return "Opus 4.6";
  }
  if (m.includes("haiku")) {
    return "Haiku 4.5";
  }
  if (m.includes("sonnet")) {
    if (m.includes("5-5") || m.includes("5.5")) return "Sonnet 5.5";
    if (m.includes("4-5") || m.includes("4.5")) return "Sonnet 4.5";
    return "Sonnet 4.6";
  }

  if (tier === "heavy") return "Opus 4.6";
  if (tier === "light") return "Haiku 4.5";
  return "Sonnet 4.6";
}

/**
 * Alias for formatModelBadge used by SubagentGraph and AgentInspectorDrawer.
 */
export function formatAgentModelBadge(
  model?: string | null,
  provider: ThermalProvider | string = "claude",
  tier: ModelTier = "standard"
): string {
  return formatModelBadge(model, provider, tier);
}

/**
 * Normalize subagent role label.
 */
export function resolveSubagentRole(
  subagentRole?: string | null,
  subagentType?: string | null,
  agentType?: string | null
): SubagentRole {
  const raw = String(subagentRole || subagentType || "")
    .toLowerCase()
    .trim();
  if (!raw && agentType === "main") return "Main";
  if (raw === "main" || raw === "orchestrator") return "Main";
  if (raw.includes("explore") || raw.includes("research") || raw.includes("search"))
    return "Explore";
  if (raw.includes("plan") || raw.includes("architect")) return "Plan";
  if (raw.includes("verif") || raw.includes("test") || raw.includes("qa")) return "Verifier";
  if (raw.includes("browser") || raw.includes("web")) return "Browser";
  if (
    raw.includes("code") ||
    raw.includes("implement") ||
    raw.includes("self") ||
    raw.includes("cascade") ||
    raw.includes("delegate")
  )
    return "Code";
  if (raw.includes("task")) return "Task";
  return agentType === "subagent" ? "Task" : "Main";
}

/**
 * Return the complete Chromatic Thermal UI theme for any agent or session.
 */
export function getAgentThermalTheme(
  input: {
    provider?: string | null;
    model?: string | null;
    model_tier?: string | null;
    effort?: string | null;
    subagent_role?: string | null;
    subagent_type?: string | null;
    type?: string | null;
    name?: string | null;
  },
  fallbackProvider?: string | null,
  fallbackModel?: string | null
): AgentThermalTheme {
  const effectiveModel = input.model || fallbackModel || null;
  const provider = resolveProvider(input.provider || fallbackProvider, effectiveModel, input.name);
  const tier = resolveModelTier({
    provider,
    modelTier: input.model_tier,
    model: effectiveModel,
    effort: input.effort,
    subagentType: input.subagent_type,
    subagentRole: input.subagent_role,
  });
  const { effort, effortLabel, effortBars } = resolveEffort(input.effort, tier);
  const role = resolveSubagentRole(input.subagent_role, input.subagent_type, input.type);
  const modelShortName = formatModelBadge(effectiveModel, provider, tier);

  // Pool 1: agy-claude (Claude / GPT-OSS running inside Google Antigravity — Neon Magenta/Indigo Spectrum)
  if (provider === "agy-claude") {
    if (tier === "heavy") {
      return {
        provider,
        providerLabel: "AGY • Claude Pool",
        providerPillLabel: "AGY • claude pool",
        tier,
        tierLabel: "Pool 1 Heavy",
        label: `Pool 1 · ${modelShortName}`,
        effort,
        effortLabel,
        effortBars,
        role,
        modelShortName,
        cardClass:
          "bg-fuchsia-500/10 border-fuchsia-500/50 text-fuchsia-300 shadow-[0_0_20px_rgba(217,70,239,0.24)]",
        borderClass: "border-fuchsia-500/50",
        bgGradientClass: "bg-gradient-to-br from-fuchsia-950/35 via-slate-900/90 to-slate-950",
        glowClass: "shadow-[0_0_20px_rgba(217,70,239,0.24)]",
        badgeClass: "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40",
        providerPillClass: "bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-400/50",
        dotColorClass: "bg-fuchsia-400",
        dotClass: "bg-fuchsia-400",
        barFillClass: "bg-fuchsia-400",
        barActiveClass: "bg-fuchsia-400",
        strokeHex: "#d946ef",
        svgStroke: "#d946ef",
        glowHex: "rgba(217,70,239,0.38)",
        spectrumLabel: "Electric Fuchsia",
      };
    }
    return {
      provider,
      providerLabel: "AGY • Claude Pool",
      providerPillLabel: "AGY • claude pool",
      tier,
      tierLabel: "Pool 1 Standard",
      label: `Pool 1 · ${modelShortName}`,
      effort,
      effortLabel,
      effortBars,
      role,
      modelShortName,
      cardClass:
        "bg-indigo-500/10 border-indigo-500/50 text-indigo-300 shadow-[0_0_16px_rgba(99,102,241,0.22)]",
      borderClass: "border-indigo-500/50",
      bgGradientClass: "bg-gradient-to-br from-indigo-950/35 via-slate-900/90 to-slate-950",
      glowClass: "shadow-[0_0_16px_rgba(99,102,241,0.22)]",
      badgeClass: "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40",
      providerPillClass: "bg-indigo-500/25 text-indigo-200 border border-indigo-400/50",
      dotColorClass: "bg-indigo-400",
      dotClass: "bg-indigo-400",
      barFillClass: "bg-indigo-400",
      barActiveClass: "bg-indigo-400",
      strokeHex: "#6366f1",
      svgStroke: "#6366f1",
      glowHex: "rgba(99,102,241,0.35)",
      spectrumLabel: "Neon Indigo",
    };
  }

  // Pool 2: agy-gemini / antigravity (Cool Thermal Spectrum: Electric Purple / Cyber Blue / Emerald Green)
  if (provider === "antigravity") {
    if (tier === "heavy") {
      return {
        provider,
        providerLabel: "Google Antigravity",
        providerPillLabel: "ANTIGRAVITY",
        tier,
        tierLabel: "Deep / Heavy",
        label: `Deep · ${modelShortName}`,
        effort,
        effortLabel,
        effortBars,
        role,
        modelShortName,
        cardClass:
          "bg-purple-600/10 border-purple-500/50 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.22)]",
        borderClass: "border-purple-500/50",
        bgGradientClass: "bg-gradient-to-br from-purple-950/35 via-slate-900/90 to-slate-950",
        glowClass: "shadow-[0_0_20px_rgba(168,85,247,0.22)]",
        badgeClass: "bg-purple-500/20 text-purple-300 border border-purple-500/40",
        providerPillClass: "bg-purple-500/25 text-purple-200 border border-purple-400/50",
        dotColorClass: "bg-purple-400",
        dotClass: "bg-purple-400",
        barFillClass: "bg-purple-400",
        barActiveClass: "bg-purple-400",
        strokeHex: "#a855f7",
        svgStroke: "#a855f7",
        glowHex: "rgba(168,85,247,0.35)",
        spectrumLabel: "Electric Purple",
      };
    }
    if (tier === "light") {
      return {
        provider,
        providerLabel: "Google Antigravity",
        providerPillLabel: "ANTIGRAVITY",
        tier,
        tierLabel: "Fast / Light",
        label: `Fast · ${modelShortName}`,
        effort,
        effortLabel,
        effortBars,
        role,
        modelShortName,
        cardClass:
          "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]",
        borderClass: "border-emerald-500/50",
        bgGradientClass: "bg-gradient-to-br from-emerald-950/35 via-slate-900/90 to-slate-950",
        glowClass: "shadow-[0_0_12px_rgba(16,185,129,0.15)]",
        badgeClass: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
        providerPillClass: "bg-emerald-500/25 text-emerald-200 border border-emerald-400/50",
        dotColorClass: "bg-emerald-400",
        dotClass: "bg-emerald-400",
        barFillClass: "bg-emerald-400",
        barActiveClass: "bg-emerald-400",
        strokeHex: "#10b981",
        svgStroke: "#10b981",
        glowHex: "rgba(16,185,129,0.3)",
        spectrumLabel: "Emerald Green",
      };
    }
    // Standard Tier (Cyber Blue)
    return {
      provider,
      providerLabel: "Google Antigravity",
      providerPillLabel: "ANTIGRAVITY",
      tier,
      tierLabel: "Standard Flow",
      label: `Flow · ${modelShortName}`,
      effort,
      effortLabel,
      effortBars,
      role,
      modelShortName,
      cardClass:
        "bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.18)]",
      borderClass: "border-blue-500/50",
      bgGradientClass: "bg-gradient-to-br from-blue-950/35 via-slate-900/90 to-slate-950",
      glowClass: "shadow-[0_0_15px_rgba(59,130,246,0.18)]",
      badgeClass: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
      providerPillClass: "bg-blue-500/25 text-blue-200 border border-blue-400/50",
      dotColorClass: "bg-blue-400",
      dotClass: "bg-blue-400",
      barFillClass: "bg-blue-400",
      barActiveClass: "bg-blue-400",
      strokeHex: "#3b82f6",
      svgStroke: "#3b82f6",
      glowHex: "rgba(59,130,246,0.3)",
      spectrumLabel: "Cyber Blue",
    };
  }

  // Pool 3: Claude Direct (Warm Thermal Spectrum: Crimson Red / Vibrant Orange / Amber Yellow)
  if (tier === "heavy") {
    return {
      provider,
      providerLabel: "Claude Code",
      providerPillLabel: "CLAUDE",
      tier,
      tierLabel: "Heavy / Opus",
      label: `Heavy · ${modelShortName}`,
      effort,
      effortLabel,
      effortBars,
      role,
      modelShortName,
      cardClass:
        "bg-red-500/10 border-red-500/50 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]",
      borderClass: "border-red-500/50",
      bgGradientClass: "bg-gradient-to-br from-red-950/35 via-slate-900/90 to-slate-950",
      glowClass: "shadow-[0_0_20px_rgba(239,68,68,0.2)]",
      badgeClass: "bg-red-500/20 text-red-300 border border-red-500/40",
      providerPillClass: "bg-red-500/25 text-red-200 border border-red-400/50",
      dotColorClass: "bg-red-400",
      dotClass: "bg-red-400",
      barFillClass: "bg-red-400",
      barActiveClass: "bg-red-400",
      strokeHex: "#ef4444",
      svgStroke: "#ef4444",
      glowHex: "rgba(239,68,68,0.35)",
      spectrumLabel: "Crimson Red",
    };
  }
  if (tier === "light") {
    return {
      provider,
      providerLabel: "Claude Code",
      providerPillLabel: "CLAUDE",
      tier,
      tierLabel: "Light / Haiku",
      label: `Fast · ${modelShortName}`,
      effort,
      effortLabel,
      effortBars,
      role,
      modelShortName,
      cardClass:
        "bg-amber-400/10 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.15)]",
      borderClass: "border-amber-400/50",
      bgGradientClass: "bg-gradient-to-br from-amber-950/30 via-slate-900/90 to-slate-950",
      glowClass: "shadow-[0_0_12px_rgba(251,191,36,0.15)]",
      badgeClass: "bg-amber-400/20 text-amber-200 border border-amber-400/40",
      providerPillClass: "bg-amber-400/25 text-amber-100 border border-amber-400/50",
      dotColorClass: "bg-amber-300",
      dotClass: "bg-amber-300",
      barFillClass: "bg-amber-300",
      barActiveClass: "bg-amber-300",
      strokeHex: "#fbbf24",
      svgStroke: "#fbbf24",
      glowHex: "rgba(251,191,36,0.3)",
      spectrumLabel: "Amber Yellow",
    };
  }
  // Standard Tier (Vibrant Orange)
  return {
    provider,
    providerLabel: "Claude Code",
    providerPillLabel: "CLAUDE",
    tier,
    tierLabel: "Standard / Sonnet",
    label: `Standard · ${modelShortName}`,
    effort,
    effortLabel,
    effortBars,
    role,
    modelShortName,
    cardClass:
      "bg-orange-500/10 border-orange-500/50 text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.18)]",
    borderClass: "border-orange-500/50",
    bgGradientClass: "bg-gradient-to-br from-orange-950/30 via-slate-900/90 to-slate-950",
    glowClass: "shadow-[0_0_15px_rgba(249,115,22,0.18)]",
    badgeClass: "bg-orange-500/20 text-orange-300 border border-orange-500/40",
    providerPillClass: "bg-orange-500/25 text-orange-200 border border-orange-400/50",
    dotColorClass: "bg-orange-400",
    dotClass: "bg-orange-400",
    barFillClass: "bg-orange-400",
    barActiveClass: "bg-orange-400",
    strokeHex: "#f97316",
    svgStroke: "#f97316",
    glowHex: "rgba(249,115,22,0.3)",
    spectrumLabel: "Vibrant Orange",
  };
}

/** One of the three operational quota pools DualAgent Nexus tracks. */
export interface QuotaPoolBadge {
  pool: 1 | 2 | 3;
  id: "agy-claude" | "agy-gemini" | "claude-direct";
  /** Pill text, e.g. "POOL 1 • AGY-CLAUDE". */
  label: string;
}

/**
 * Map a thermal provider to its operational quota pool. Pool 1 is Google-paid Claude/GPT-OSS
 * via `agy-cascade`, Pool 2 is Google-paid Gemini/Argon via `agy-cascade`, and Pool 3 is the
 * direct Anthropic subscription (Main conductor and Haiku Explore subagents). Codex and Cursor
 * rows are not part of the waterfall and are reported under Pool 3.
 *
 * @param provider - Provider resolved by {@link resolveProvider} or {@link getAgentThermalTheme}.
 * @returns Pool number, id, and pill label.
 */
export function resolveQuotaPoolBadge(provider: ThermalProvider | string): QuotaPoolBadge {
  if (provider === "agy-claude") return { pool: 1, id: "agy-claude", label: "POOL 1 • AGY-CLAUDE" };
  if (provider === "antigravity" || provider === "agy-gemini") {
    return { pool: 2, id: "agy-gemini", label: "POOL 2 • AGY-GEMINI" };
  }
  return { pool: 3, id: "claude-direct", label: "POOL 3 • CLAUDE DIRECT" };
}

/**
 * Strips XML/HTML tags (such as <fork-boilerplate>...</fork-boilerplate> and <tag>...</tag>)
 * and cleans extraneous whitespace from agent tasks, names, and descriptions.
 */
export function sanitizeAgentText(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/<fork-boilerplate[\s\S]*?<\/fork-boilerplate>/gi, "")
    .replace(/<task-description[\s\S]*?<\/task-description>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "")
    .trim();
}
