import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface StatTileProps {
  label: string;
  icon: IconName;
  /** Accent for the icon, e.g. `var(--em-chart-cpu)`. */
  accent: string;
  value: ReactNode;
  unit?: string;
  /** Secondary line under the value. */
  hint?: ReactNode;
  /** Right side of the header, e.g. an availability badge. */
  status?: ReactNode;
  /** Usually a sparkline. */
  children?: ReactNode;
  className?: string;
}

export function StatTile({ label, icon, accent, value, unit, hint, status, children, className }: StatTileProps) {
  return (
    <section
      aria-label={label}
      className={cx("flex min-w-0 flex-col rounded-lg border border-line bg-surface shadow-card", className)}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="grid size-6 shrink-0 place-items-center rounded-md"
            style={{ color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)` }}
          >
            <Icon name={icon} size={14} />
          </span>
          <h2 className="truncate text-xs font-semibold tracking-wide text-fg-muted uppercase">{label}</h2>
        </div>
        {status}
      </div>
      <div className="px-4 pt-2">
        <div className="flex items-baseline gap-1">
          <span className="tabular selectable font-display text-metric font-semibold tracking-tight text-fg">
            {value}
          </span>
          {unit && <span className="text-sm font-medium text-fg-subtle">{unit}</span>}
        </div>
        {hint != null && <div className="mt-0.5 truncate text-xs text-fg-subtle">{hint}</div>}
      </div>
      {children != null && <div className="mt-auto pt-2">{children}</div>}
    </section>
  );
}
