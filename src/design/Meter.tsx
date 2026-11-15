import { cx } from "./cx";
import { toneBg, toneForUtilisation, type Tone } from "./tone";

export interface MeterProps {
  /** Percentage, 0-100. Values outside the range are clamped. */
  value: number;
  /** Fixed tone; defaults to utilisation-based (base -> warning -> danger). */
  tone?: Tone;
  /** Tone used below the warning threshold when `tone` is not set. */
  baseTone?: Tone;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function Meter({ value, tone, baseTone = "primary", label, className, size = "md" }: MeterProps) {
  const pct = clampPercent(value);
  const resolved = tone ?? toneForUtilisation(pct, baseTone);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cx(
        "w-full overflow-hidden rounded-full bg-line",
        size === "sm" ? "h-1" : "h-1.5",
        className,
      )}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-500 ease-out-soft", toneBg[resolved])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
