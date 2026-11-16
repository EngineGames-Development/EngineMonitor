import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer buttons. */
  actions: ReactNode;
  tone?: "default" | "danger";
}

/**
 * Modal dialog. Escape and the backdrop close it; focus moves into the
 * dialog on open (to the element marked `data-autofocus`, else the first
 * button) and returns to the previously focused element on close. Tab is
 * kept inside the dialog.
 */
export function Dialog({ open, title, onClose, children, actions, tone = "default" }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const target = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("button");
    target?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && el) {
        const focusable = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input, [tabindex]:not([tabindex='-1'])"));
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative w-full max-w-md rounded-lg border bg-overlay p-5 shadow-pop animate-fade-in",
          tone === "danger" ? "border-danger/40" : "border-line-strong",
        )}
      >
        <h2 id={titleId} className="font-display text-lg font-semibold text-fg">
          {title}
        </h2>
        <div className="mt-2 text-sm text-fg-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}
