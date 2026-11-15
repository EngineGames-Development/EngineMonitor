import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned header content (badges, buttons). */
  actions?: ReactNode;
  /** Remove body padding, e.g. for edge-to-edge charts or tables. */
  flush?: boolean;
}

export function Card({ title, subtitle, actions, flush, className, children, ...rest }: CardProps) {
  const hasHeader = title != null || actions != null;
  return (
    <section
      className={cx(
        "rounded-lg border border-line bg-surface shadow-card",
        "flex min-w-0 flex-col",
        className,
      )}
      {...rest}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
          <div className="min-w-0">
            {title != null && (
              <h2 className="truncate text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {title}
              </h2>
            )}
            {subtitle != null && <p className="mt-0.5 truncate text-xs text-fg-subtle">{subtitle}</p>}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("min-w-0 flex-1", !flush && (hasHeader ? "px-4 pb-4" : "p-4"))}>
        {children}
      </div>
    </section>
  );
}
