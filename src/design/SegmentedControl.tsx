import { useRef, type KeyboardEvent } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
}

/** Radio-group semantics with roving focus (arrow keys move and select). */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + options.length) % options.length;
    else return;
    e.preventDefault();
    const option = options[next];
    if (option) {
      onChange(option.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-raised p-0.5">
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-xs font-medium transition-colors duration-150",
              selected ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg",
            )}
          >
            {opt.icon && <Icon name={opt.icon} size={14} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
