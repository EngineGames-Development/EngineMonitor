import { readingValue, type Snapshot, type SnapshotEvent } from "../ipc/types";

/**
 * One point of the in-memory live history used by real-time graphs.
 * `null` means "no measurement for this tick" and is drawn as a gap, never
 * as zero.
 */
export interface HistoryPoint {
  /** Sample time, ms since the Unix epoch. */
  t: number;
  cpu: number | null;
  memory: number | null;
  /** Network receive / transmit, bytes per second (non-loopback total). */
  rx: number | null;
  tx: number | null;
  /** Disk read / write across volumes that report I/O, bytes per second. */
  diskRead: number | null;
  diskWrite: number | null;
  /** Busiest GPU adapter's utilisation. */
  gpu: number | null;
  /** Per-core utilisation, index = logical core. */
  cores: (number | null)[];
}

/** Default live window (ms). */
export const DEFAULT_WINDOW_MS = 5 * 60_000;
/** Hard cap on points regardless of window (60 min at 250 ms = 14 400). */
export const MAX_HISTORY_POINTS = 15_000;

/** Sum of the non-null values, or null if there are none. */
export function sumKnown(values: Iterable<number | null>): number | null {
  let total: number | null = null;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
}

/** Highest utilisation among adapters that report one, or null. */
export function busiestGpu(s: Snapshot): number | null {
  if (s.gpu.status !== "ok") return null;
  let max: number | null = null;
  for (const g of s.gpu.value) {
    const u = readingValue(g.usagePercent);
    if (u !== null && (max === null || u > max)) max = u;
  }
  return max;
}

export function toHistoryPoint(s: Snapshot): HistoryPoint {
  const io = s.storage.flatMap((v) => (v.io.status === "ok" ? [v.io.value] : []));
  return {
    t: s.timestampMs,
    cpu: s.cpu.usagePercent,
    memory: s.memory.usagePercent,
    rx: s.network.receiveBytesPerSec,
    tx: s.network.transmitBytesPerSec,
    diskRead: sumKnown(io.map((d) => d.readBytesPerSec)),
    diskWrite: sumKnown(io.map((d) => d.writeBytesPerSec)),
    gpu: busiestGpu(s),
    cores: s.cpu.cores.map((c) => c.usagePercent),
  };
}

export function gapPoint(t: number): HistoryPoint {
  return { t, cpu: null, memory: null, rx: null, tx: null, diskRead: null, diskWrite: null, gpu: null, cores: [] };
}

/**
 * Appends an event to the history, keeping at most `capacity` points.
 * If events were missed (sequence gap), a gap point is inserted first so the
 * chart does not draw a straight line across the missing period.
 */
export function appendEvent(
  history: readonly HistoryPoint[],
  previous: SnapshotEvent | null,
  event: SnapshotEvent,
  windowMs: number = DEFAULT_WINDOW_MS,
): HistoryPoint[] {
  const last = history[history.length - 1];
  // Ignore duplicates/out-of-order deliveries (e.g. latest_snapshot racing the first event).
  if (last && event.snapshot.timestampMs <= last.t) return history as HistoryPoint[];

  const additions: HistoryPoint[] = [];
  if (previous && event.sequence > previous.sequence + 1) {
    additions.push(gapPoint(Math.round((previous.snapshot.timestampMs + event.snapshot.timestampMs) / 2)));
  }
  additions.push(toHistoryPoint(event.snapshot));

  return trimToWindow([...history, ...additions], windowMs);
}

/**
 * Keeps points within `windowMs` of the newest one (by time, so changing the
 * refresh interval does not change how much time the graphs show), plus a
 * hard cap on the number of points.
 */
export function trimToWindow(points: HistoryPoint[], windowMs: number): HistoryPoint[] {
  const newest = points[points.length - 1];
  if (!newest) return points;
  const cutoff = newest.t - windowMs;
  let start = 0;
  while (start < points.length && points[start]!.t < cutoff) start++;
  start = Math.max(start, points.length - MAX_HISTORY_POINTS);
  return start > 0 ? points.slice(start) : points;
}
