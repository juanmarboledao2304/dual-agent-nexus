/**
 * @file Popover.tsx
 * @description Minimal anchored popover for the top bar (quota meter, needs-you list): a trigger button
 * toggles a panel aligned to its right edge; Escape and clicks outside close it and focus returns to the
 * trigger. The panel pops in with a short scale-and-fade that reduced-motion users skip.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Props for {@link Popover}. */
export interface PopoverProps {
  /** Trigger content. */
  trigger: ReactNode;
  /** Accessible name for the trigger. */
  label: string;
  /** Panel content; receives a `close` callback. */
  children: (close: () => void) => ReactNode;
  /** Panel width class. */
  widthClass?: string;
  /** Extra trigger classes. */
  triggerClassName?: string;
}

/**
 * Anchored popover.
 *
 * @returns Trigger plus the panel when open.
 */
export function Popover({
  trigger,
  label,
  children,
  widthClass = "w-[380px]",
  triggerClassName = "",
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`absolute right-0 top-[calc(100%+8px)] z-50 max-w-[calc(100vw-24px)] ${widthClass} origin-top-right animate-pop-in rounded-xl border border-border-light bg-surface-2 p-4 shadow-overlay motion-reduce:animate-none`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
