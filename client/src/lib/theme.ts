/**
 * @file theme.ts
 * @description Visual theme selection for the Nexus Console design system. Themes are CSS variable sets
 * injected by the Tailwind theme plugin; this module persists the choice in localStorage (guarded, the
 * app still works when storage throws) and applies it as `data-theme` on the document element.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

/** Available visual themes. */
export const THEMES = ["duet", "console"] as const;

/** One visual theme id. */
export type ThemeId = (typeof THEMES)[number];

/** localStorage key for the chosen theme. */
export const THEME_STORAGE_KEY = "nexus-theme";

/** Theme used when nothing valid is stored. */
export const DEFAULT_THEME: ThemeId = "duet";

/**
 * Read the persisted theme.
 *
 * @returns The stored theme, or the default when unset, invalid, or storage is unavailable.
 */
export function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return (THEMES as readonly string[]).includes(stored ?? "")
      ? (stored as ThemeId)
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Apply a theme to the document element without persisting it.
 *
 * @param theme - Theme to apply.
 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  if (theme === "console") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Apply and persist a theme.
 *
 * @param theme - Theme to use from now on.
 */
export function saveTheme(theme: ThemeId): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the theme still applies for this page load.
  }
}
