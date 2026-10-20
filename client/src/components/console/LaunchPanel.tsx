/**
 * @file LaunchPanel.tsx
 * @description Right-side Launch panel that replaced the floating Command Center dock. It opens from
 * the top bar's "Run agent" button or the command palette and offers the two ways to start work: an
 * interactive Claude Code or Codex conversation (the /run page) and a one-shot dispatch to
 * agy-cascade, the AGY fan-out, Claude Code, Antigravity, or a dual swarm (the dispatcher, rendered
 * inline). Escape or the backdrop closes it; focus moves into the panel and back to the trigger. It
 * stays mounted while hidden so running dispatches keep their live console and kill switch.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { MessagesSquare, X } from "lucide-react";
import { LAUNCH_PANEL_EVENT } from "../../lib/appEvents";
import { CommandCenterDock } from "../CommandCenterDock";

/**
 * Launch panel host: listens for the open event and renders the drawer.
 *
 * @returns The drawer when open.
 */
export function LaunchPanel() {
  const { t } = useTranslation("console");
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    const onOpen = () => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(LAUNCH_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(LAUNCH_PANEL_EVENT, onOpen);
  }, []);

  // Navigating away (e.g. to /run) closes the panel.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) {
      returnFocus.current?.focus?.();
      return;
    }
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Stays mounted while closed so running dispatches keep streaming into the dispatcher console.
  return (
    <div className={open ? "fixed inset-0 z-50" : "hidden"} aria-hidden={!open}>
      <button
        type="button"
        aria-label={t("launch.close")}
        onClick={() => setOpen(false)}
        className="absolute inset-0 cursor-default bg-black/50 animate-fade-in motion-reduce:animate-none"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-title"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[720px] flex-col border-l border-border-light bg-surface-1 shadow-overlay outline-none animate-drawer-in motion-reduce:animate-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id="launch-title" className="text-[17px] font-semibold text-gray-50">
              {t("launch.title")}
            </h2>
            <p className="mt-0.5 text-[13px] text-gray-400">{t("launch.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("launch.close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-surface-3 hover:text-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Link
            to="/run"
            className="mx-5 mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 transition-colors hover:border-border-light hover:bg-surface-3"
          >
            <MessagesSquare className="h-5 w-5 shrink-0 text-gray-300" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-gray-50">
                {t("launch.conversation")}
              </span>
              <span className="block text-[13px] text-gray-400">
                {t("launch.conversationHint")}
              </span>
            </span>
          </Link>

          <h3 className="mx-5 mt-6 text-[14px] font-semibold text-gray-100">
            {t("launch.dispatch")}
          </h3>
          <p className="mx-5 mb-1 text-[13px] text-gray-400">{t("launch.dispatchHint")}</p>
          <CommandCenterDock variant="panel" />
        </div>
      </div>
    </div>
  );
}
