/**
 * @file CreateAgentDialog.tsx
 * @description Modal form for creating a sandbox agent in the Agent World: name,
 * 8-bit character (with sprite previews), starting room, and a free-text task.
 * Escape cancels and Tab cycles focus inside the dialog.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { PixelAvatar } from "../PixelAvatar";
import { ROOM_ZONES } from "../../utils/agentRooms";
import type { RoomZoneId } from "../../utils/agentRooms";
import { SPRITE_DEFINITIONS, SPRITE_VARIANT_ORDER } from "../../utils/pixelSprites";
import type { SpriteVariant } from "../../utils/pixelSprites";
import type { SandboxDraft } from "../../utils/world/sandbox";

/** Props for {@link CreateAgentDialog}. */
export interface CreateAgentDialogProps {
  open: boolean;
  /** Suggested name, e.g. "Agent 3". */
  defaultName: string;
  onCreate: (draft: SandboxDraft) => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Sandbox agent creation dialog. Renders nothing while closed. */
export function CreateAgentDialog({
  open,
  defaultName,
  onCreate,
  onCancel,
}: CreateAgentDialogProps) {
  const { t } = useTranslation("world");
  const titleId = useId();
  const panelRef = useRef<HTMLFormElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(defaultName);
  const [variant, setVariant] = useState<SpriteVariant>("claude-sonnet");
  const [zone, setZone] = useState<RoomZoneId>("engine");
  const [task, setTask] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setTask("");
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => nameRef.current?.select(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) return;
      const first = items.item(0);
      const last = items.item(items.length - 1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, defaultName, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-overlay"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ name: name.trim() || defaultName, variant, zone, task: task.trim() });
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="section-title">
            {t("create")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("cancel")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-surface-3 hover:text-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="micro-label">{t("name")}</span>
            <input
              ref={nameRef}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="input mt-1.5 w-full"
            />
          </label>

          <fieldset>
            <legend className="micro-label">{t("sprite")}</legend>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {SPRITE_VARIANT_ORDER.map((v) => {
                const active = v === variant;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={active}
                    title={SPRITE_DEFINITIONS[v].label}
                    onClick={() => setVariant(v)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition-colors ${
                      active
                        ? "border-accent bg-accent-muted text-gray-50"
                        : "border-border bg-surface-2 text-gray-400 hover:border-border-light hover:text-gray-200"
                    }`}
                  >
                    <PixelAvatar
                      variant={v}
                      state="idle"
                      size={32}
                      showBadge={false}
                      framed={false}
                      indicator={false}
                    />
                    <span className="w-full truncate text-center">
                      {SPRITE_DEFINITIONS[v].label}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className="micro-label">{t("zone")}</span>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value as RoomZoneId)}
              className="input mt-1.5 w-full"
            >
              {ROOM_ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {t(`zones.${z.id}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="micro-label">{t("task")}</span>
            <input
              value={task}
              maxLength={120}
              placeholder={t("taskPlaceholder")}
              onChange={(e) => setTask(e.target.value)}
              className="input mt-1.5 w-full"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" onClick={onCancel} className="btn-ghost">
            {t("cancel")}
          </button>
          <button type="submit" className="btn-primary">
            {t("createAction")}
          </button>
        </div>
      </form>
    </div>
  );
}
