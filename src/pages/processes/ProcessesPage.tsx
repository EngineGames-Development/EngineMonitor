import { useEffect, useMemo, useRef, useState } from "react";
import {
  AvailabilityBadge,
  Badge,
  Card,
  cx,
  ErrorState,
  Icon,
  PageHeader,
  SegmentedControl,
  Skeleton,
} from "../../design";
import { useVirtualRows } from "../../design/useVirtualRows";
import { setProcessMonitoring } from "../../ipc/commands";
import type { AppError } from "../../ipc/errors";
import type { ProcessSample } from "../../ipc/types";
import { formatByteRate, formatBytes, formatPercent, UNAVAILABLE } from "../../lib/format";
import { streamAvailability } from "../../metrics/availability";
import { useMetrics } from "../../metrics/MetricsProvider";
import { routeById } from "../../navigation/routes";
import { ProcessDetail } from "./ProcessDetail";
import {
  defaultDir,
  diskRate,
  FILTER_LABELS,
  visibleProcesses,
  type ProcessFilter,
  type SortDir,
  type SortKey,
} from "./processTable";

const ROW_HEIGHT = 34;

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; className: string; numeric?: boolean }> = [
  { key: "name", label: "Name", className: "w-auto" },
  { key: "pid", label: "PID", className: "w-20", numeric: true },
  { key: "cpu", label: "CPU", className: "w-20", numeric: true },
  { key: "memory", label: "Memory", className: "w-28", numeric: true },
  { key: "disk", label: "Disk", className: "w-28", numeric: true },
  { key: "status", label: "Status", className: "w-24" },
];

/** Enables the backend process stream while mounted. */
function useProcessStream(): AppError | null {
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    let active = true;
    setProcessMonitoring(true).then((r) => {
      if (active && !r.ok) setError(r.error);
    });
    return () => {
      active = false;
      void setProcessMonitoring(false);
    };
  }, []);
  return error;
}

export function ProcessesPage() {
  const metrics = useMetrics();
  const streamError = useProcessStream();
  const list = metrics.latest?.processes ?? null;
  const route = routeById("processes");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProcessFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cpu", dir: "desc" });
  const [selected, setSelected] = useState<{ pid: number; start: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(
    () => (list ? visibleProcesses(list.processes, query, filter, sort.key, sort.dir) : []),
    [list, query, filter, sort],
  );
  const selectedProcess = selected
    ? (list?.processes.find((p) => p.pid === selected.pid && p.startTimeSecs === selected.start) ?? null)
    : null;

  const error = streamError ?? (metrics.status === "error" ? metrics.error : null);

  function onSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) }));
  }

  return (
    <>
      <PageHeader
        title={route.label}
        description={list ? `${list.processes.length} processes · ${rows.length} shown` : route.description}
        actions={<AvailabilityBadge availability={streamAvailability(metrics, performance.now())} />}
      />

      {error ? (
        <Card>
          <ErrorState title="Process list unavailable" message={error.message} />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="relative min-w-56 flex-1 sm:max-w-sm">
              <span className="sr-only">Search processes</span>
              <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, path or PID"
                className="selectable h-8 w-full rounded-md border border-line-strong bg-raised pr-3 pl-8 text-sm text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none"
              />
            </label>
            <SegmentedControl
              label="Filter processes"
              value={filter}
              onChange={setFilter}
              options={(Object.keys(FILTER_LABELS) as ProcessFilter[]).map((f) => ({ value: f, label: FILTER_LABELS[f] }))}
            />
          </div>

          {notice && (
            <div role="status" className="mb-3 flex items-center justify-between rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-fg">
              <span className="flex items-center gap-2">
                <Icon name="check" size={15} className="text-success" />
                {notice}
              </span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-fg-muted hover:text-fg">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          <div className="flex min-h-0 gap-4">
            <Card flush className="min-w-0 flex-1 overflow-hidden">
              {list === null ? (
                <div aria-busy="true" aria-label="Collecting process list" className="space-y-2 p-4">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} className="h-6" />
                  ))}
                </div>
              ) : (
                <ProcessTable
                  rows={rows}
                  ownPid={list.ownPid}
                  sort={sort}
                  onSort={onSort}
                  selectedPid={selectedProcess?.pid ?? null}
                  onSelect={(p) => setSelected({ pid: p.pid, start: p.startTimeSecs })}
                />
              )}
            </Card>
            {selected && (
              <ProcessDetail
                process={selectedProcess}
                isSelf={selectedProcess?.pid === list?.ownPid}
                parent={selectedProcess?.parentPid != null ? (list?.processes.find((p) => p.pid === selectedProcess.parentPid) ?? null) : null}
                onSelect={(p) => setSelected({ pid: p.pid, start: p.startTimeSecs })}
                onClose={() => setSelected(null)}
                onTerminated={(p) => {
                  setSelected(null);
                  setNotice(`Ended ${p.name} (PID ${p.pid}).`);
                }}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

interface ProcessTableProps {
  rows: readonly ProcessSample[];
  ownPid: number;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  selectedPid: number | null;
  onSelect: (p: ProcessSample) => void;
}

function ProcessTable({ rows, ownPid, sort, onSort, selectedPid, onSelect }: ProcessTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const win = useVirtualRows(scrollRef, rows.length, ROW_HEIGHT);
  const visible = rows.slice(win.start, win.end);
  const bottom = win.totalHeight - win.offsetTop - visible.length * ROW_HEIGHT;

  return (
    <div ref={scrollRef} className="h-[calc(100vh-15rem)] min-h-80 overflow-auto">
      <table className="w-full table-fixed border-collapse text-sm" aria-rowcount={rows.length + 1}>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line">
            {COLUMNS.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cx("h-9 px-3 font-medium", c.className, c.numeric ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className={cx(
                      "inline-flex items-center gap-1 text-xs tracking-wide uppercase transition-colors",
                      active ? "text-fg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {c.label}
                    {active && <span aria-hidden="true">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {win.offsetTop > 0 && <tr aria-hidden="true" style={{ height: win.offsetTop }} />}
          {visible.map((p, i) => {
            const disk = diskRate(p);
            const selected = p.pid === selectedPid;
            return (
              <tr
                key={`${p.pid}:${p.startTimeSecs}`}
                aria-rowindex={win.start + i + 2}
                aria-selected={selected}
                onClick={() => onSelect(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(p);
                  }
                }}
                tabIndex={0}
                style={{ height: ROW_HEIGHT }}
                className={cx(
                  "cursor-default border-b border-line/60 outline-none focus-visible:bg-hover",
                  selected ? "bg-primary-soft" : "hover:bg-hover",
                )}
              >
                <td className="truncate px-3 text-fg" title={p.exe ?? p.name}>
                  <span className="selectable">{p.name}</span>
                  {p.pid === ownPid && (
                    <Badge tone="primary" className="ml-2 align-middle">
                      This app
                    </Badge>
                  )}
                </td>
                <td className="tabular px-3 text-right text-fg-muted">{p.pid}</td>
                <td className="tabular px-3 text-right text-fg">{p.cpuPercent === null ? UNAVAILABLE : `${formatPercent(p.cpuPercent)} %`}</td>
                <td className="tabular px-3 text-right text-fg">{formatBytes(p.memoryBytes)}</td>
                <td className="tabular px-3 text-right text-fg-muted">{disk === null ? UNAVAILABLE : formatByteRate(disk)}</td>
                <td className="truncate px-3 text-fg-muted capitalize">{p.status}</td>
              </tr>
            );
          })}
          {bottom > 0 && <tr aria-hidden="true" style={{ height: bottom }} />}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-fg-muted">No processes match.</p>}
    </div>
  );
}
