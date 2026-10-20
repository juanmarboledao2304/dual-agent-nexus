/**
 * @file SessionsHub.tsx
 * @description The Sessions section: a switch between the sessions table and the live event stream
 * (the former Activity page), so everything about past and present runs lives in one place. The view
 * lives in the URL (`?show=events`) so the old /activity route and Home's "All events" link land on
 * the stream directly.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useTranslation } from "react-i18next";
import { Activity, ScrollText } from "lucide-react";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { ActivityFeed } from "./ActivityFeed";
import { Sessions } from "./Sessions";

const VIEWS = ["sessions", "events"] as const;

/**
 * Sessions page with the events stream as a second view.
 *
 * @returns The page.
 */
export function SessionsHub() {
  const { t } = useTranslation("console");
  const [view, setView] = useUrlTab(VIEWS, "sessions", { param: "show" });
  return (
    <div className="flex flex-col gap-5">
      <div className="segmented self-start" role="tablist" aria-label={t("sessions.views")}>
        {VIEWS.map((v) => {
          const Icon = v === "sessions" ? ScrollText : Activity;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className="segmented-item"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(`sessions.${v}`)}
            </button>
          );
        })}
      </div>
      {view === "sessions" ? <Sessions /> : <ActivityFeed />}
    </div>
  );
}
