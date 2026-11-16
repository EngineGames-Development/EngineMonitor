import type { HistoryPointDto, VolumeSeries } from "../../ipc/types";

export interface RangeOption {
  id: string;
  label: string;
  ms: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RANGES: readonly RangeOption[] = [
  { id: "15m", label: "15 min", ms: 15 * MIN },
  { id: "1h", label: "1 hour", ms: HOUR },
  { id: "6h", label: "6 hours", ms: 6 * HOUR },
  { id: "24h", label: "24 hours", ms: DAY },
  { id: "7d", label: "7 days", ms: 7 * DAY },
  { id: "30d", label: "30 days", ms: 30 * DAY },
];

/** Points requested per query; enough for a crisp line at typical widths. */
export const MAX_POINTS = 480;

export type ChartPoint = {
  t: number;
  [series: string]: number | null;
};

function emptyLike(t: number, keys: readonly string[]): ChartPoint {
  const p: ChartPoint = { t };
  for (const k of keys) p[k] = null;
  return p;
}

/**
 * Inserts null points where consecutive buckets are further apart than
 * 1.5 buckets, so periods without data (app not running, recording off)
 * render as gaps instead of straight lines.
 */
export function withGaps<P extends { t: number }>(points: readonly P[], bucketMs: number, keys: readonly string[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && p.t - prev.t > bucketMs * 1.5) {
      out.push(emptyLike(prev.t + bucketMs, keys));
    }
    out.push(p as unknown as ChartPoint);
  }
  return out;
}

export const METRIC_KEYS = ["cpu", "cpuMax", "memory", "swap", "netRx", "netTx", "diskRead", "diskWrite", "gpu"] as const;

export function historyChartData(points: readonly HistoryPointDto[], bucketMs: number): ChartPoint[] {
  return withGaps(points, bucketMs, METRIC_KEYS);
}

/** True if a series has at least one measured value in the result. */
export function hasValues(points: readonly HistoryPointDto[], key: (typeof METRIC_KEYS)[number]): boolean {
  return points.some((p) => p[key] !== null);
}

/**
 * Merges per-volume series into one row per timestamp with keys `v0`, `v1`, …
 * (Recharts needs a single data array). Returns the key → mount point map.
 */
export function mergeVolumes(volumes: readonly VolumeSeries[], bucketMs: number): { data: ChartPoint[]; series: { key: string; mountPoint: string }[] } {
  const series = volumes.map((v, i) => ({ key: `v${i}`, mountPoint: v.mountPoint }));
  const keys = series.map((s) => s.key);
  const byTime = new Map<number, ChartPoint>();
  volumes.forEach((v, i) => {
    for (const p of v.points) {
      let row = byTime.get(p.t);
      if (!row) {
        row = emptyLike(p.t, keys);
        byTime.set(p.t, row);
      }
      row[`v${i}`] = p.usedPercent;
    }
  });
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
  return { data: withGaps(sorted, bucketMs, keys), series };
}

export function formatBucket(ms: number): string {
  if (ms < MIN) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `${+(ms / HOUR).toFixed(1)} h`;
  return `${+(ms / DAY).toFixed(1)} d`;
}
