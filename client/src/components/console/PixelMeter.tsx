/**
 * @file PixelMeter.tsx
 * @description 8-bit segmented fuel gauge: N equal blocks with pixel gaps, filled from the left in
 * proportion to a 0..1 value. Used for quota remaining in the top bar, the Home quota card, and the
 * Usage page. Exposes a proper `meter` role so the value is announced, not only drawn.
 * @author Juan Manuel Arboleda Orozco (github.com/juanmarboledao2304)
 */

/** Props for {@link PixelMeter}. */
export interface PixelMeterProps {
  /** Filled fraction, 0..1 (clamped). */
  value: number;
  /** Number of blocks. */
  blocks?: number;
  /** Tailwind background class for filled blocks, e.g. "bg-clay-400". */
  fillClass: string;
  /** Height class, e.g. "h-1.5". */
  heightClass?: string;
  /** Accessible name, e.g. "Claude Direct quota remaining". */
  label: string;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Segmented meter.
 *
 * @returns The meter.
 */
export function PixelMeter({
  value,
  blocks = 20,
  fillClass,
  heightClass = "h-1.5",
  label,
  className = "",
}: PixelMeterProps) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  // Round up so any non-zero remainder still lights one block.
  const filled = clamped > 0 ? Math.max(1, Math.round(clamped * blocks)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={`pixel-meter ${heightClass} ${className}`}
    >
      {Array.from({ length: blocks }, (_, i) => (
        <span key={i} className={i < filled ? fillClass : "bg-surface-4"} />
      ))}
    </div>
  );
}
