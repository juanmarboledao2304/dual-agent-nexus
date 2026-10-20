/**
 * @file SettingsHub.tsx
 * @description The Settings section: one place for everything you configure, split into three labelled
 * sections in the URL (`?section=`): Dashboard (appearance, data source, pricing, notifications,
 * webhooks, hooks, remote sources, snapshots, imports, companion), Your Claude setup (the former Config
 * explorer: skills, subagents, commands, MCP servers, plugins, hooks, memory), and System health
 * (database, server, hooks and cache status, formerly a hidden Dashboard tab). The appearance card picks
 * the visual theme.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Boxes, HeartPulse, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { THEMES, loadTheme, saveTheme } from "../lib/theme";
import type { ThemeId } from "../lib/theme";
import { CcConfig } from "./CcConfig";
import { SystemHealthTab } from "./SystemHealth";
import { Settings } from "./Settings";

const SECTIONS = ["dashboard", "claude", "health"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_ICON: Record<Section, LucideIcon> = {
  dashboard: SlidersHorizontal,
  claude: Boxes,
  health: HeartPulse,
};

/** Swatches previewing each theme's ground and inks. */
const THEME_SWATCH: Record<ThemeId, string[]> = {
  duet: ["#1d1a24", "#f0603c", "#9b7bff", "#3fc8e4", "#f3ebdd"],
  console: ["#151517", "#e68a58", "#a698e4", "#64aedc", "#ff8a3d"],
};

/** Theme picker card. */
function Appearance() {
  const { t } = useTranslation("console");
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  return (
    <section className="card p-5" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="section-title">
        {t("settings.appearance")}
      </h2>
      <p className="mt-1 text-[13px] text-gray-400">{t("settings.appearanceHint")}</p>
      <div
        className="mt-4 grid gap-3 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t("settings.theme")}
      >
        {THEMES.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme === id}
            onClick={() => {
              saveTheme(id);
              setTheme(id);
            }}
            className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
              theme === id
                ? "border-gray-300 bg-surface-3"
                : "border-border hover:border-border-light"
            }`}
          >
            <span className="flex shrink-0 overflow-hidden rounded-md" aria-hidden>
              {THEME_SWATCH[id].map((c) => (
                <span key={c} className="h-8 w-4" style={{ background: c }} />
              ))}
            </span>
            <span>
              <span className="block text-[14px] font-medium text-gray-50">
                {t(`settings.themes.${id}.name`)}
              </span>
              <span className="block text-[13px] text-gray-400">
                {t(`settings.themes.${id}.hint`)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Settings page with section navigation.
 *
 * @returns The page.
 */
export function SettingsHub() {
  const { t } = useTranslation("console");
  const [section, setSection] = useUrlTab(SECTIONS, "dashboard", { param: "section" });
  return (
    <div className="flex flex-col gap-5">
      <div className="segmented self-start" role="tablist" aria-label={t("settings.sections")}>
        {SECTIONS.map((s) => {
          const Icon = SECTION_ICON[s];
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className="segmented-item"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(`settings.section.${s}`)}
            </button>
          );
        })}
      </div>
      {section === "dashboard" && (
        <>
          <Appearance />
          <Settings />
        </>
      )}
      {section === "claude" && <CcConfig />}
      {section === "health" && <SystemHealthTab />}
    </div>
  );
}
