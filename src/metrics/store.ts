import type { AppError } from "../ipc/errors";
import type { SnapshotEvent, SystemInfo } from "../ipc/types";
import { appendEvent, DEFAULT_WINDOW_MS, trimToWindow, type HistoryPoint } from "./history";

/**
 * Connection status of the live data stream.
 * - connecting: waiting for the first snapshot
 * - live: snapshots arriving on schedule
 * - stale: no snapshot for more than STALE_FACTOR × interval
 * - error: backend unavailable or collectors failed to start
 */
export type StreamStatus = "connecting" | "live" | "stale" | "error";

export const STALE_FACTOR = 3;

export interface MetricsState {
  status: StreamStatus;
  error: AppError | null;
  info: SystemInfo | null;
  latest: SnapshotEvent | null;
  /** performance.now() when `latest` was received. */
  receivedAt: number | null;
  history: HistoryPoint[];
  /** How much live history to keep, ms. */
  windowMs: number;
}

export type MetricsAction =
  | { type: "event"; event: SnapshotEvent; now: number }
  | { type: "info"; info: SystemInfo }
  | { type: "error"; error: AppError }
  | { type: "tick"; now: number }
  | { type: "window"; ms: number };

export function initialMetricsState(windowMs = DEFAULT_WINDOW_MS): MetricsState {
  return { status: "connecting", error: null, info: null, latest: null, receivedAt: null, history: [], windowMs };
}

export function isStale(latest: SnapshotEvent | null, receivedAt: number | null, now: number): boolean {
  if (!latest || receivedAt === null) return false;
  return now - receivedAt > latest.intervalMs * STALE_FACTOR;
}

export function metricsReducer(state: MetricsState, action: MetricsAction): MetricsState {
  switch (action.type) {
    case "event": {
      if (state.latest && action.event.sequence <= state.latest.sequence) return state;
      // A delivered event proves the stream works, whatever the previous status.
      return {
        ...state,
        status: "live",
        error: null,
        latest: action.event,
        receivedAt: action.now,
        history: appendEvent(state.history, state.latest, action.event, state.windowMs),
      };
    }
    case "info":
      return { ...state, info: action.info, error: null, status: state.status === "error" ? "connecting" : state.status };
    case "error":
      return { ...state, status: "error", error: action.error };
    case "window":
      if (action.ms === state.windowMs) return state;
      return { ...state, windowMs: action.ms, history: trimToWindow(state.history, action.ms) };
    case "tick": {
      // Recovery from "stale" happens through the next "event" action.
      if (state.status === "live" && isStale(state.latest, state.receivedAt, action.now)) {
        return { ...state, status: "stale" };
      }
      return state;
    }
  }
}
