import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Neutral placeholder for "nothing to show" situations. */
export function EmptyState({ icon = "info", title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center px-6 py-10 text-center animate-fade-in",
        className,
      )}
    >
      <div className="mb-3 grid size-10 place-items-center rounded-lg border border-line bg-raised text-fg-subtle">
        <Icon name={icon} size={20} />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description != null && (
        <div className="mt-1 max-w-md text-sm text-balance text-fg-muted">{description}</div>
      )}
      {action != null && <div className="mt-4">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

/** Shown when an operation failed. The message is the real error, not a paraphrase. */
export function ErrorState({ title = "Something went wrong", message, onRetry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cx("flex flex-col items-center px-6 py-8 text-center", className)}>
      <div className="mb-3 grid size-10 place-items-center rounded-lg border border-danger/30 bg-danger/10 text-danger">
        <Icon name="alert" size={20} />
      </div>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <p className="selectable mt-1 max-w-md font-mono text-xs break-words text-fg-muted">{message}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export interface SkeletonProps {
  className?: string;
}

/** Shimmering placeholder for content that is loading. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={cx(
        "rounded-md bg-[linear-gradient(90deg,var(--em-line)_25%,var(--em-line-strong)_50%,var(--em-line)_75%)]",
        "bg-[length:200%_100%] animate-shimmer",
        className,
      )}
    />
  );
}
