import type { ProcessSample } from "../../ipc/types";

export type SortKey = "name" | "pid" | "cpu" | "memory" | "disk" | "status";
export type SortDir = "asc" | "desc";
export type ProcessFilter = "all" | "active" | "accessible";

export const FILTER_LABELS: Record<ProcessFilter, string> = {
  all: "All",
  active: "Using CPU",
  accessible: "Path visible",
};

/** Combined disk activity, or null if neither direction has a rate yet. */
export function diskRate(p: ProcessSample): number | null {
  if (p.diskReadBytesPerSec === null && p.diskWriteBytesPerSec === null) return null;
  return (p.diskReadBytesPerSec ?? 0) + (p.diskWriteBytesPerSec ?? 0);
}

/** Case-insensitive match on name, executable path or exact PID. */
export function matchesQuery(p: ProcessSample, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (/^\d+$/.test(q) && String(p.pid) === q) return true;
  return p.name.toLowerCase().includes(q) || (p.exe?.toLowerCase().includes(q) ?? false);
}

export function matchesFilter(p: ProcessSample, filter: ProcessFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      // ≥ 0.05 % so rounding-noise processes are not listed as active.
      return (p.cpuPercent ?? 0) >= 0.05;
    case "accessible":
      return p.exe !== null;
  }
}

function sortValue(p: ProcessSample, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return p.name.toLowerCase();
    case "pid":
      return p.pid;
    case "cpu":
      return p.cpuPercent;
    case "memory":
      return p.memoryBytes;
    case "disk":
      return diskRate(p);
    case "status":
      return p.status;
  }
}

/**
 * Sorts a copy. Unknown values (null) always go last regardless of
 * direction, so "not measured yet" never masquerades as the smallest value.
 * Ties are broken by PID for a stable order between ticks.
 */
export function sortProcesses(list: readonly ProcessSample[], key: SortKey, dir: SortDir): ProcessSample[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      return (va < vb ? -1 : 1) * sign;
    }
    return a.pid - b.pid;
  });
}

export function visibleProcesses(
  list: readonly ProcessSample[],
  query: string,
  filter: ProcessFilter,
  key: SortKey,
  dir: SortDir,
): ProcessSample[] {
  return sortProcesses(
    list.filter((p) => matchesFilter(p, filter) && matchesQuery(p, query)),
    key,
    dir,
  );
}

/** Default direction when a column is first clicked: numbers high-first. */
export function defaultDir(key: SortKey): SortDir {
  return key === "name" || key === "status" || key === "pid" ? "asc" : "desc";
}
