/** Joins class names, skipping falsy values. Tiny replacement for `clsx`. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
