import { AvailabilityBadge, Card, ErrorState, PageHeader, Skeleton } from "../../design";
import { routeById } from "../../navigation/routes";
import { useMetrics } from "../../metrics/MetricsProvider";
import { streamAvailability } from "../../metrics/availability";
import { KpiRow } from "./KpiRow";
import { LiveCharts } from "./LiveCharts";
import { StorageCard } from "./StorageCard";
import { SystemCard } from "./SystemCard";
import { GpuCard } from "./GpuCard";

function LoadingLayout() {
  return (
    <div aria-busy="true" aria-label="Waiting for the first measurement" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function OverviewPage() {
  const metrics = useMetrics();
  const route = routeById("overview");

  return (
    <>
      <PageHeader
        title={route.label}
        description={route.description}
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
        <LoadingLayout />
      ) : (
        <div className="space-y-4">
          <KpiRow snapshot={metrics.latest.snapshot} history={metrics.history} />
          <div className="grid gap-4 xl:grid-cols-3">
            <LiveCharts history={metrics.history} className="xl:col-span-2" />
            <div className="grid content-start gap-4">
              <SystemCard info={metrics.info} snapshot={metrics.latest.snapshot} />
              <GpuCard gpu={metrics.latest.snapshot.gpu} />
            </div>
          </div>
          <StorageCard volumes={metrics.latest.snapshot.storage} />
        </div>
      )}
    </>
  );
}
