/**
 * @file TopNav.tsx
 * @description Sticky top bar of the Nexus Console: brand with a live-connection dot, the five
 * labelled sections (Home, Agents, Sessions, Usage, Settings; icon-only in compact mode), a visible
 * search field that opens the command palette, the Claude Direct quota meter, the Needs-you bell, the
 * connection pill with its diagnostics modal, the language picker, and the single primary "Run agent"
 * action that opens the Launch panel. A two-ink "duet rule" runs under the bar. The update check stays
 * wired to the command palette's "check for updates" event.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useState } from "react";
import { Link, NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { Bot, Gauge, House, Play, ScrollText, Search, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NexusMark } from "../NexusMark";
import { openCommandPalette, openLaunchPanel } from "../../lib/appEvents";
import { NeedsYouBell } from "../console/NeedsYou";
import { QuotaMeter } from "../console/QuotaMeter";
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
}

/** The five sections, in display order. "Run agent" is the separate primary action, not a tab. */
export const NAV_TABS: readonly NavTab[] = [
  { to: "/", icon: House, key: "home" },
  { to: "/agents", icon: Bot, key: "agents" },
  { to: "/sessions", icon: ScrollText, key: "sessions" },
  { to: "/usage", icon: Gauge, key: "usage" },
  { to: "/settings", icon: Settings, key: "settings" },
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
    <header className="sticky top-0 z-30 border-b border-border bg-surface-0/85 backdrop-blur supports-[backdrop-filter]:bg-surface-0/75">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className="relative flex shrink-0 items-center gap-2.5 rounded-lg pr-1"
          aria-label={t("nav:brand")}
        >
          <NexusMark size={26} />
          <span
            className={`absolute left-[19px] top-[19px] h-2 w-2 rounded-full ring-2 ring-surface-0 ${
              wsConnected ? "bg-mint-400" : "bg-coral-400"
            }`}
            aria-hidden
          />
          <span className="hidden font-pixel text-[15px] tracking-tight text-gray-50 md:inline">
            Nexus
          </span>
        </Link>

        <nav
          aria-label={t("nav:primary")}
          className="no-scrollbar ml-2 flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          {NAV_TABS.map(({ to, icon: Icon, key }) => {
            const label = t(`nav:tabs.${key}`);
            return (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                title={compact ? label : undefined}
                aria-label={compact ? label : undefined}
                className={({ isActive }) =>
                  `inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 ${
                    isActive
                      ? "bg-surface-3 text-gray-50"
                      : "text-gray-400 hover:bg-surface-2 hover:text-gray-100"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {!compact && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={t("nav:search")}
          className="ml-auto hidden h-8 min-w-0 max-w-[260px] flex-1 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 text-[13px] text-gray-500 transition-colors hover:border-border-light hover:text-gray-300 md:flex"
        >
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("nav:searchPlaceholder")}</span>
          <kbd className="ml-auto shrink-0 rounded border border-border-light px-1.5 font-sans text-[11px] text-gray-400">
            {usesCommandKey() ? "Cmd K" : "Ctrl K"}
          </kbd>
        </button>
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={t("nav:search")}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-200 md:hidden"
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <QuotaMeter />
          <NeedsYouBell />

          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            aria-label={t("nav:connectionDetails")}
            title={`${wsConnected ? t("nav:live") : t("nav:disconnected")} ${versionLabel} (${checkTitle})`}
            className="hidden h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-medium text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-200 lg:inline-flex"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                wsConnected ? "bg-mint-400 animate-pulse-dot" : "bg-coral-400"
              }`}
              aria-hidden
            />
            {wsConnected ? t("nav:live") : t("nav:disconnected")}
          </button>

          <LanguagePicker
            value={currentLanguage}
            options={languageOptions}
            label={t("nav:language")}
            onChange={changeLanguage}
          />

          <button
            type="button"
            onClick={openLaunchPanel}
            className="btn-primary ml-1 h-8 py-0"
            aria-label={t("nav:runAgent")}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden md:inline">{t("nav:runAgent")}</span>
          </button>
        </div>
      </div>
      <div className="duet-rule opacity-70" aria-hidden />

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
