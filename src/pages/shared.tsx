import type { ReactNode } from "react";
import { AvailabilityBadge, Card, ErrorState, PageHeader, Skeleton } from "../design";
import type { Snapshot, SnapshotEvent, SystemInfo } from "../ipc/types";
import { streamAvailability } from "../metrics/availability";
import type { HistoryPoint } from "../metrics/history";
import { useMetrics } from "../metrics/MetricsProvider";
import { routeById, type RouteId } from "../navigation/routes";

export interface LiveData {
  info: SystemInfo;
  latest: SnapshotEvent;
  snapshot: Snapshot;
  history: readonly HistoryPoint[];
}

/**
 * Standard frame for live monitoring pages: header with stream status, then
 * error / loading / content. `children` only renders once real data exists.
 */
export function LivePage({ route, children }: { route: RouteId; children: (data: LiveData) => ReactNode }) {
  const metrics = useMetrics();
  const def = routeById(route);
  return (
    <>
      <PageHeader
        title={def.label}
        description={def.description}
        actions={<AvailabilityBadge availability={streamAvailability(metrics, performance.now())} />}
      />
      {metrics.status === "error" ? (
        <Card>
          <ErrorState
            title={metrics.error?.kind === "no_backend" ? "Backend unavailable" : "Monitoring unavailable"}
            message={metrics.error?.message ?? "Unknown error"}
          />
        </Card>
      ) : metrics.latest === null || metrics.info === null ? (
        <div aria-busy="true" aria-label="Waiting for the first measurement" className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        children({ info: metrics.info, latest: metrics.latest, snapshot: metrics.latest.snapshot, history: metrics.history })
      )}
    </>
  );
}

/** A row of labelled values inside one card. */
export function StatStrip({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode; hint?: ReactNode }> }) {
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="truncate text-xs text-fg-muted">{i.label}</dt>
            <dd className="selectable tabular mt-0.5 truncate font-display text-lg font-semibold text-fg">{i.value}</dd>
            {i.hint != null && <dd className="mt-0.5 truncate text-2xs text-fg-subtle">{i.hint}</dd>}
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function Legend({ items }: { items: ReadonlyArray<{ label: string; color: string }> }) {
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-fg-muted">
          <span className="size-2 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
