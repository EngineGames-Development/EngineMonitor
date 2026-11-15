import { Badge } from "./Badge";
import type { Tone } from "./tone";

/**
 * Data-availability state of a metric. Every metric in the UI carries one, so
 * the user can always tell a real reading from a missing one.
 */
export type Availability =
  | { state: "live" }
  | { state: "loading" }
  | { state: "stale"; ageSeconds: number }
  | { state: "unsupported"; reason: string }
  | { state: "error"; message: string }
  /** The feature has not been built yet. Used only while development is in progress. */
  | { state: "notImplemented"; milestone: number };

const presentation: Record<Availability["state"], { tone: Tone; label: string }> = {
  live: { tone: "success", label: "Live" },
  loading: { tone: "neutral", label: "Loading" },
  stale: { tone: "warning", label: "Stale" },
  unsupported: { tone: "neutral", label: "Unsupported" },
  error: { tone: "danger", label: "Error" },
  notImplemented: { tone: "info", label: "Not implemented" },
};

export function availabilityDetail(a: Availability): string | undefined {
  switch (a.state) {
    case "stale":
      return `Last update ${Math.round(a.ageSeconds)} s ago`;
    case "unsupported":
      return a.reason;
    case "error":
      return a.message;
    case "notImplemented":
      return `Planned for milestone ${a.milestone}`;
    default:
      return undefined;
  }
}

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  const { tone, label } = presentation[availability.state];
  return (
    <Badge tone={tone} dot pulse={availability.state === "live"} title={availabilityDetail(availability)}>
      {label}
    </Badge>
  );
}
