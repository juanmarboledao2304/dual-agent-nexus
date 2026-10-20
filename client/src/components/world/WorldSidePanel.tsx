/**
 * @file WorldSidePanel.tsx
 * @description Side panel for the Agent World: Live / Sandbox tabs listing every
 * agent on the map (the keyboard-accessible way to select them), and a detail
 * card for the selection. Live agents are read-only and offer only the
 * inspector; sandbox agents can be paused, resumed, renamed, moved to another
 * room, or deleted.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Trash2, PanelRightOpen, Check } from "lucide-react";
import { PixelAvatar } from "../PixelAvatar";
import { ROOM_ZONES } from "../../utils/agentRooms";
import type { RoomZoneId } from "../../utils/agentRooms";
import type { WorldActivity, WorldSource } from "../../utils/world/entities";
import type { SpriteVariant } from "../../utils/pixelSprites";

/** What the panel needs to know about one agent (a throttled snapshot of the simulation). */
export interface WorldAgentSummary {
  id: string;
  source: WorldSource;
  name: string;
  variant: SpriteVariant;
  zone: RoomZoneId;
  activity: WorldActivity;
  task: string | null;
}

/** Props for {@link WorldSidePanel}. */
export interface WorldSidePanelProps {
  agents: WorldAgentSummary[];
  selectedId: string | null;
  tab: WorldSource;
  onTabChange: (tab: WorldSource) => void;
  onSelect: (id: string) => void;
  onOpenInspector: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onMoveToZone: (id: string, zone: RoomZoneId) => void;
}

const ACTIVITY_DOT: Record<WorldActivity, string> = {
  idle: "bg-gray-500",
  walking: "bg-sky-400",
  working: "bg-accent",
  thinking: "bg-violet-400",
  waiting: "bg-amber-300",
  paused: "bg-gray-600",
  done: "bg-emerald-400",
  error: "bg-red-400",
};

/** Agent list and selection details. */
export function WorldSidePanel({
  agents,
  selectedId,
  tab,
  onTabChange,
  onSelect,
  onOpenInspector,
  onPause,
  onResume,
  onDelete,
  onRename,
  onMoveToZone,
}: WorldSidePanelProps) {
  const { t } = useTranslation("world");
  const selected = agents.find((a) => a.id === selectedId) ?? null;
  const listed = agents.filter((a) => a.source === tab);
  const counts = {
    live: agents.filter((a) => a.source === "live").length,
    sandbox: agents.filter((a) => a.source === "sandbox").length,
  };
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    setDraftName(selected?.name ?? "");
  }, [selected?.id, selected?.name]);

  return (
    <aside className="card flex min-h-0 flex-col overflow-hidden">
      <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b border-border p-2">
        {(["live", "sandbox"] as const).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => onTabChange(key)}
            className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition-colors ${
              tab === key
                ? "bg-surface-3 text-gray-50"
                : "text-gray-400 hover:bg-surface-3 hover:text-gray-100"
            }`}
          >
            {t(key)}
            <span className="rounded-full bg-surface-4 px-1.5 font-mono text-[11px] text-gray-300">
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      <ul role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={t(tab)}>
        {listed.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] leading-relaxed text-gray-500">
            {t(tab === "live" ? "emptyLive" : "emptySandbox")}
          </li>
        )}
        {listed.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              aria-current={a.id === selectedId ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
                a.id === selectedId ? "bg-surface-3" : "hover:bg-surface-2"
              }`}
            >
              <PixelAvatar
                variant={a.variant}
                state="idle"
                size={24}
                showBadge={false}
                framed={false}
                indicator={false}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-gray-100">
                  {a.name}
                </span>
                <span className="block truncate text-[11px] text-gray-500">
                  {t(`zones.${a.zone}`)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-400">
                <span className={`h-1.5 w-1.5 rounded-full ${ACTIVITY_DOT[a.activity]}`} />
                {t(`activity.${a.activity}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section className="border-t border-border p-4" aria-live="polite">
        {!selected ? (
          <p className="text-[13px] text-gray-500">{t("selectHint")}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <PixelAvatar
                variant={selected.variant}
                state="idle"
                size={40}
                showBadge={false}
                framed={false}
                indicator={false}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-50">{selected.name}</p>
                <p className="text-[12px] text-gray-400">
                  {t(`source.${selected.source}`)} · {t(`zones.${selected.zone}`)} ·{" "}
                  {t(`activity.${selected.activity}`)}
                </p>
              </div>
            </div>
            {selected.task && (
              <p className="line-clamp-3 text-[12px] leading-relaxed text-gray-300">
                {selected.task}
              </p>
            )}

            {selected.source === "live" ? (
              <>
                <p className="text-[12px] leading-relaxed text-gray-500">{t("readOnly")}</p>
                <button
                  type="button"
                  className="btn-ghost w-full justify-center border border-border"
                  onClick={() => onOpenInspector(selected.id)}
                >
                  <PanelRightOpen className="h-4 w-4" aria-hidden />
                  {t("openInspector")}
                </button>
              </>
            ) : (
              <>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(selected.id, draftName);
                  }}
                >
                  <input
                    aria-label={t("rename")}
                    value={draftName}
                    maxLength={40}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="input h-8 min-w-0 flex-1 py-1"
                  />
                  <button type="submit" className="btn-ghost h-8 border border-border">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {t("save")}
                  </button>
                </form>
                <label className="block">
                  <span className="micro-label">{t("moveTo")}</span>
                  <select
                    value={selected.zone}
                    onChange={(e) => onMoveToZone(selected.id, e.target.value as RoomZoneId)}
                    className="input mt-1.5 h-8 w-full py-1"
                  >
                    {ROOM_ZONES.map((z) => (
                      <option key={z.id} value={z.id}>
                        {t(`zones.${z.id}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  {selected.activity === "paused" ? (
                    <button
                      type="button"
                      className="btn-ghost flex-1 justify-center border border-border"
                      onClick={() => onResume(selected.id)}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      {t("resume")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost flex-1 justify-center border border-border"
                      onClick={() => onPause(selected.id)}
                    >
                      <Pause className="h-3.5 w-3.5" aria-hidden />
                      {t("pause")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost flex-1 justify-center border border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                    onClick={() => onDelete(selected.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t("delete")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
