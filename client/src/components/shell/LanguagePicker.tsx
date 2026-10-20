/**
 * @file LanguagePicker.tsx
 * @description Icon-trigger UI language picker used by the top navigation: the
 * supported language list, language-code normalization, and a portalled,
 * viewport-clamped option menu. Moved from the former Sidebar component.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Check } from "lucide-react";

export const SUPPORTED_LANGUAGES = ["en", "zh", "vi", "ko", "es"] as const;
/** One supported UI language code. */
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Width of the language menu, in pixels. */
const COLLAPSED_LANGUAGE_MENU_WIDTH = 240;
/** Minimum distance kept between the language menu and the viewport edge, in pixels. */
const VIEWPORT_GUTTER = 12;
/** Maximum height of the language menu before it scrolls, in pixels. */
const LANGUAGE_MENU_MAX_HEIGHT = 288;

/**
 * Map an i18next language code (for example `zh-CN` or `es-419`) to a supported UI language by its
 * base code.
 *
 * @param language - Detected or stored language code.
 * @returns The matching supported language, or `en` as the fallback.
 */
export function normalizeLanguage(language: string): SupportedLanguage {
  const base = language.toLowerCase().split("-")[0];
  if (base === "zh" || base === "vi" || base === "en" || base === "ko" || base === "es") {
    return base;
  }
  return "en";
}

/** Props for {@link LanguagePicker}. */
interface LanguagePickerProps {
  /** Current language. */
  value: SupportedLanguage;
  /** Languages to offer, each with its native label and a hint. */
  options: Array<{ value: SupportedLanguage; label: string; hint: string }>;
  /** Accessible label for the trigger button. */
  label: string;
  /** Called with the chosen language. */
  onChange: (language: SupportedLanguage) => void;
}

/**
 * Compact icon-trigger language control for the top navigation. The option list
 * is portalled to the body so the navigation bar's overflow clipping cannot
 * constrain it.
 */
export function LanguagePicker({ value, options, label, onChange }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top?: number; bottom?: number }>(
    {
      left: VIEWPORT_GUTTER,
      top: VIEWPORT_GUTTER,
    }
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  /**
   * Place the language menu next to its trigger, at most 240px wide, opening
   * upward or downward to fit and clamped inside the viewport.
   */
  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(COLLAPSED_LANGUAGE_MENU_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
    const left = Math.min(
      Math.max(VIEWPORT_GUTTER, rect.left),
      Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER)
    );
    const opensAbove =
      window.innerHeight - rect.bottom < LANGUAGE_MENU_MAX_HEIGHT &&
      rect.top > window.innerHeight - rect.bottom;

    setMenuPosition(
      opensAbove
        ? { left, bottom: Math.max(VIEWPORT_GUTTER, window.innerHeight - rect.top + 8) }
        : { left, top: Math.min(window.innerHeight - VIEWPORT_GUTTER, rect.bottom + 8) }
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    positionMenu();
    /** Close the menu on a press outside both the trigger and the menu. */
    const closeOnOutsidePress = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    /** Close the menu on Escape and return focus to the trigger. */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  /**
   * Pick a language, close the menu, and return focus to the trigger.
   *
   * @param language - Chosen language.
   */
  const chooseLanguage = (language: SupportedLanguage) => {
    onChange(language);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const menu = open && typeof document !== "undefined" && (
    <div
      ref={menuRef}
      id={menuId}
      role="listbox"
      aria-label={label}
      className="fixed z-[80] max-h-72 overflow-auto rounded-lg border border-border bg-surface-1 py-1 shadow-xl shadow-black/40 animate-fade-in"
      style={{
        ...menuPosition,
        width: `min(${COLLAPSED_LANGUAGE_MENU_WIDTH}px, calc(100vw - ${VIEWPORT_GUTTER * 2}px))`,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => chooseLanguage(option.value)}
            className={`w-full px-3 py-2 text-left transition-colors hover:bg-surface-3 ${
              selected ? "bg-accent/10" : ""
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  selected ? "font-medium text-accent" : "text-gray-200"
                }`}
              >
                {option.label}
              </span>
              {selected && <Check className="h-3.5 w-3.5 flex-shrink-0 text-accent" aria-hidden />}
            </span>
            <div className="mt-0.5 truncate text-[10px] text-gray-500">{option.hint}</div>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-100"
      >
        <Globe className="h-4 w-4" aria-hidden />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
