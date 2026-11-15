import type { ReactNode } from "react";
import { cx } from "./cx";
import { toneBg, toneText, type Tone } from "./tone";

export interface BadgeProps {
  tone?: Tone;
  /** Show a leading status dot. */
  dot?: boolean;
  /** Pulse the dot (use only for live data). */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = "neutral", dot, pulse, children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-5 items-center gap-1.5 rounded-full border border-line px-2",
        "text-2xs font-medium whitespace-nowrap",
        toneText[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && (
            <span
              className={cx(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                toneBg[tone],
              )}
            />
          )}
          <span className={cx("relative inline-flex size-1.5 rounded-full", toneBg[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}
