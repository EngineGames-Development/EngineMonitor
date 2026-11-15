import type { ReactNode } from "react";
import { cx } from "./cx";

export interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}

/** A labelled numeric value with tabular figures and an optional unit. */
export function Metric({ label, value, unit, hint, size = "md", className }: MetricProps) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="truncate text-xs text-fg-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={cx(
            "tabular selectable font-display font-semibold tracking-tight text-fg",
            size === "lg" ? "text-metric" : "text-lg",
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-fg-subtle">{unit}</span>}
      </div>
      {hint != null && <div className="mt-0.5 truncate text-2xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
