import type { ReactNode } from "react";
import { cx } from "./cx";
import { toneBg, toneText, type Tone } from "./tone";

export interface BadgeProps {
  tone?: Tone;
  /** Show a leading status dot. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Small status label. The dot is deliberately static: an infinite CSS
 * animation (the former "pulse" on live badges) kept the WebView repainting at
 * 60 fps and cost ~30 % of a CPU core in the release app, even when minimised.
 */
export function Badge({ tone = "neutral", dot, children, className, title }: BadgeProps) {
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
        <span aria-hidden="true" className={cx("inline-flex size-1.5 rounded-full", toneBg[tone])} />
      )}
      {children}
    </span>
  );
}
