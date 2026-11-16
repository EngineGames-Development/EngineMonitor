import type { Snapshot, SnapshotEvent } from "../ipc/types";

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
}

/** Default live-history length: 5 minutes at the default 1 s interval. */
export const DEFAULT_HISTORY_CAPACITY = 300;

/** Sum of the non-null values, or null if there are none. */
export function sumKnown(values: Iterable<number | null>): number | null {
  let total: number | null = null;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
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
  };
}

export function gapPoint(t: number): HistoryPoint {
  return { t, cpu: null, memory: null, rx: null, tx: null, diskRead: null, diskWrite: null };
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
  capacity: number = DEFAULT_HISTORY_CAPACITY,
): HistoryPoint[] {
  const last = history[history.length - 1];
  // Ignore duplicates/out-of-order deliveries (e.g. latest_snapshot racing the first event).
  if (last && event.snapshot.timestampMs <= last.t) return history as HistoryPoint[];

  const additions: HistoryPoint[] = [];
  if (previous && event.sequence > previous.sequence + 1) {
    additions.push(gapPoint(Math.round((previous.snapshot.timestampMs + event.snapshot.timestampMs) / 2)));
  }
  additions.push(toHistoryPoint(event.snapshot));

  const next = history.length + additions.length > capacity
    ? history.slice(history.length + additions.length - capacity)
    : history.slice();
  next.push(...additions);
  return next;
}
