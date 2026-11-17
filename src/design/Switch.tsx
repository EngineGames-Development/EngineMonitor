import { cx } from "./cx";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** On/off toggle with `role="switch"` semantics. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-primary" : "border-line-strong bg-raised",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-block size-3.5 rounded-full shadow-card transition-transform duration-150",
          checked ? "translate-x-[18px] bg-primary-fg" : "translate-x-[3px] bg-fg-muted",
        )}
      />
    </button>
  );
}
