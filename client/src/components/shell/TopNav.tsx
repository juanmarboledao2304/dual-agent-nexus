/**
 * @file TopNav.tsx
 * @description Sticky top navigation for the DualAgent Nexus shell: brand, primary
 * route tabs (icon + short label, or icon-only in compact mode), command-palette
 * trigger, live-connection pill with its diagnostics modal, update check, language
 * picker, GitHub link, and the single primary "Run agent" action.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useState } from "react";
import { Link, NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Boxes,
  Gamepad2,
  Gauge,
  Github,
  LayoutDashboard,
  LayoutGrid,
  Network,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NexusMark } from "../NexusMark";
import { openCommandPalette } from "../../lib/appEvents";
import { ConnectionStatusModal } from "./ConnectionStatusModal";
import { LanguagePicker, SUPPORTED_LANGUAGES, normalizeLanguage } from "./LanguagePicker";
import type { SupportedLanguage } from "./LanguagePicker";
import { useConnectionStats, useUpdateCheck } from "./connectionStats";

/** Public repository the GitHub link opens. */
export const REPO_URL = "https://github.com/juanmarboledao2304/dual-agent-nexus";

/**
 * localStorage key for the compact (icon-only) navigation preference. It reuses the former
 * sidebar-collapsed key so an existing preference carries over.
 */
export const NAV_COMPACT_STORAGE_KEY = "sidebar-collapsed";

/** One primary navigation tab. */
interface NavTab {
  to: string;
  icon: LucideIcon;
  /** Short label key under `nav:tabs`. */
  key: string;
  /** Utility destinations render icon-only to keep the bar on one line. */
  iconOnly?: boolean;
}

/** Primary tabs in display order. "Run agent" is the separate primary action, not a tab. */
export const NAV_TABS: readonly NavTab[] = [
  { to: "/", icon: LayoutDashboard, key: "overview" },
  { to: "/world", icon: Gamepad2, key: "world" },
  { to: "/rooms", icon: LayoutGrid, key: "rooms" },
  { to: "/sessions", icon: ScrollText, key: "sessions" },
  { to: "/activity", icon: Activity, key: "activity" },
  { to: "/cascade-graph", icon: Network, key: "cascade" },
  { to: "/quota-roi", icon: Gauge, key: "quota" },
  { to: "/cc-config", icon: Boxes, key: "config", iconOnly: true },
  { to: "/settings", icon: Settings, key: "settings", iconOnly: true },
];

/**
 * Read the persisted compact-navigation preference.
 *
 * @returns True when compact mode was saved; false when unset or storage is unavailable.
 */
export function loadNavCompact(): boolean {
  try {
    return localStorage.getItem(NAV_COMPACT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Props for {@link TopNav}. */
export interface TopNavProps {
  /** Live WebSocket state; drives the connection pill. */
  wsConnected: boolean;
  /** Icon-only tabs (toggled from the command palette's layout action). */
  compact: boolean;
}

/** Whether the platform's palette shortcut uses the Command key. */
function usesCommandKey(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || "");
}

/**
 * Top navigation bar. Tabs scroll horizontally on narrow screens instead of wrapping, and the
 * active tab carries a 2px Ember underline aligned with the bar's bottom hairline.
 */
export function TopNav({ wsConnected, compact }: TopNavProps) {
  const { t, i18n } = useTranslation();
  const [statusOpen, setStatusOpen] = useState(false);
  const stats = useConnectionStats(wsConnected);
  const update = useUpdateCheck();

  const currentLanguage = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const languageOptions = SUPPORTED_LANGUAGES.map((language) => ({
    value: language,
    label: t(`nav:languageNames.${language}`),
    hint: t(`nav:languageShort.${language}`),
  }));
  const changeLanguage = (language: SupportedLanguage) => {
    if (language !== currentLanguage) void i18n.changeLanguage(language);
  };

  const checkTitle = update.checking
    ? t("nav:checkingForUpdates")
    : update.checkError
      ? t("nav:checkFailed")
      : update.status
        ? t("nav:upToDate")
        : t("nav:checkForUpdates");
  const versionLabel = `v${__APP_VERSION__}`;

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-surface-0/85 backdrop-blur supports-[backdrop-filter]:bg-surface-0/70">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg pr-1"
          aria-label={t("nav:brand")}
        >
          <NexusMark size={28} />
          <span className="hidden text-sm font-semibold tracking-[-0.01em] text-gray-50 md:inline">
            {t("nav:brand")}
          </span>
        </Link>

        <span className="hidden h-5 w-px bg-border md:block" aria-hidden />

        <nav
          aria-label={t("nav:primary")}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {NAV_TABS.map(({ to, icon: Icon, key, iconOnly }) => {
            const label = t(`nav:tabs.${key}`);
            const showLabel = !compact && !iconOnly;
            return (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                title={showLabel ? undefined : label}
                aria-label={showLabel ? undefined : label}
                className={({ isActive }) =>
                  `relative inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                    isActive
                      ? "bg-surface-3 text-gray-50"
                      : "text-gray-400 hover:bg-surface-3 hover:text-gray-100"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {showLabel && <span>{label}</span>}
                    {isActive && (
                      <span
                        className="absolute inset-x-2 -bottom-[13px] h-0.5 rounded-full bg-accent"
                        aria-hidden
                      />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={t("nav:search")}
            title={`${t("nav:search")} (${usesCommandKey() ? "Cmd" : "Ctrl"}+K)`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-200"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            aria-label={t("nav:connectionDetails")}
            title={`${t("nav:connectionDetails")} · ${versionLabel}`}
            className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium text-gray-300 transition-colors hover:bg-surface-3"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-emerald-400 animate-pulse-dot" : "bg-red-400"
              }`}
              aria-hidden
            />
            <span className="hidden sm:inline">
              {wsConnected ? t("nav:live") : t("nav:disconnected")}
            </span>
            <span className="hidden font-mono text-[11px] text-gray-500 xl:inline">
              {versionLabel}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void update.check()}
            disabled={update.checking}
            title={checkTitle}
            aria-label={checkTitle}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-3 disabled:opacity-60 ${
              update.checkError ? "text-amber-300" : "text-gray-400 hover:text-gray-100"
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${update.checking ? "animate-spin" : ""}`} aria-hidden />
          </button>

          <LanguagePicker
            value={currentLanguage}
            options={languageOptions}
            label={t("nav:language")}
            onChange={changeLanguage}
          />

          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("nav:github")}
            aria-label={t("nav:github")}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-100 sm:inline-flex"
          >
            <Github className="h-4 w-4" aria-hidden />
          </a>

          <Link to="/run" className="btn-primary ml-1 h-8 py-0" aria-label={t("nav:runAgent")}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden md:inline">{t("nav:runAgent")}</span>
          </Link>
        </div>
      </div>

      <ConnectionStatusModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        wsConnected={wsConnected}
        connectedSince={stats.connectedSince}
        eventCountRef={stats.eventCountRef}
        peakPerSecRef={stats.peakPerSecRef}
        lastEventRef={stats.lastEventRef}
        eventTimestampsRef={stats.eventTimestampsRef}
        typeCountRef={stats.typeCountRef}
        recentEventsRef={stats.recentEventsRef}
        onResetStats={stats.resetStats}
      />
    </header>
  );
}
