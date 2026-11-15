/** Semantic colour tones shared by badges, meters and status indicators. */
export type Tone = "neutral" | "primary" | "secondary" | "success" | "warning" | "danger" | "info";

export const toneText: Record<Tone, string> = {
  neutral: "text-fg-muted",
  primary: "text-primary",
  secondary: "text-secondary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export const toneBg: Record<Tone, string> = {
  neutral: "bg-fg-subtle",
  primary: "bg-primary",
  secondary: "bg-secondary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/**
 * Tone for a utilisation percentage. Thresholds follow common monitoring
 * practice: >= 90 % critical, >= 75 % elevated.
 */
export function toneForUtilisation(percent: number, base: Tone = "primary"): Tone {
  if (!Number.isFinite(percent)) return "neutral";
  if (percent >= 90) return "danger";
  if (percent >= 75) return "warning";
  return base;
}
