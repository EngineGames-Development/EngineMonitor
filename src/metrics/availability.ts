import type { Availability } from "../design";
import type { Reading } from "../ipc/types";
import type { MetricsState } from "./store";

/** Availability of the live stream as a whole. */
export function streamAvailability(state: Pick<MetricsState, "status" | "error" | "latest" | "receivedAt">, now: number): Availability {
  switch (state.status) {
    case "connecting":
      return { state: "loading" };
    case "live":
      return { state: "live" };
    case "stale":
      return { state: "stale", ageSeconds: state.receivedAt === null ? 0 : (now - state.receivedAt) / 1000 };
    case "error":
      return { state: "error", message: state.error?.message ?? "Unknown error" };
  }
}

/** Availability of a single `Reading`. */
export function readingAvailability<T>(reading: Reading<T>): Availability {
  switch (reading.status) {
    case "ok":
      return { state: "live" };
    case "unsupported":
      return { state: "unsupported", reason: reading.reason };
    case "error":
      return { state: "error", message: reading.message };
  }
}
