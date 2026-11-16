import { useMemo, useState } from "react";
import { Card, EmptyState, ErrorState, PageHeader, SegmentedControl, Skeleton, TimeSeriesChart } from "../../design";
import { formatBitRate, formatByteRate, formatPercent } from "../../lib/format";
import { routeById } from "../../navigation/routes";
import { Legend } from "../shared";
import { formatBucket, hasValues, historyChartData, mergeVolumes, RANGES } from "./historyData";
import { HistorySettingsCard } from "./HistorySettingsCard";
import { useHistory } from "./useHistory";

const pct = (v: number) => `${formatPercent(v)} %`;
const VOLUME_COLORS = ["var(--em-chart-memory)", "var(--em-chart-disk)", "var(--em-chart-gpu)", "var(--em-chart-net-down)", "var(--em-chart-net-up)", "var(--em-chart-cpu)"];

export function HistoryPage() {
  const [rangeId, setRangeId] = useState("1h");
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1]!;
  const history = useHistory(range.ms);
  const def = routeById("history");

  const charts = useMemo(() => {
    if (history.status !== "ready") return null;
    const { query } = history;
    return {
      data: historyChartData(query.points, query.bucketMs),
      volumes: mergeVolumes(query.volumes, query.bucketMs),
      domain: [query.fromMs, query.toMs] as [number, number],
      hasGpu: hasValues(query.points, "gpu"),
      hasSwap: hasValues(query.points, "swap"),
    };
  }, [history]);

  const timeFormat = range.ms > 24 * 3_600_000 ? "datetime" : "time";
  const common = { xDomain: charts?.domain, timeFormat, height: 180 } as const;

  return (
    <>
      <PageHeader
        title={def.label}
        description={
          history.status === "ready"
            ? `${def.description} · one point per ${formatBucket(history.query.bucketMs)}`
            : def.description
        }
        actions={
          <SegmentedControl
            label="Time range"
            value={rangeId}
            onChange={setRangeId}
            options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
          />
        }
      />

      {history.status === "error" ? (
        <Card>
          <ErrorState
            title={history.error.kind === "no_backend" ? "Backend unavailable" : "History unavailable"}
            message={history.error.message}
            onRetry={history.reload}
          />
        </Card>
      ) : history.status === "loading" || !charts ? (
        <div aria-busy="true" aria-label="Loading history" className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-56 xl:col-span-2" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="grid content-start gap-4 xl:col-span-2">
            {history.query.points.length === 0 ? (
              <Card>
                <EmptyState
                  icon="history"
                  title="No history in this range yet"
                  description={
                    history.info.settings.enabled
                      ? `Recording is on: one point every ${history.info.settings.intervalSecs} s. Points are written to disk in batches, so the first ones appear within about 30 seconds.`
                      : "Recording is turned off. Turn it on to start collecting history."
                  }
                />
              </Card>
            ) : (
              <>
                <Card
                  title="CPU & memory"
                  actions={
                    <Legend
                      items={[
                        { label: "CPU (avg)", color: "var(--em-chart-cpu)" },
                        { label: "CPU (peak)", color: "var(--em-chart-disk)" },
                        { label: "Memory", color: "var(--em-chart-memory)" },
                        ...(charts.hasSwap ? [{ label: "Swap", color: "var(--em-chart-net-down)" }] : []),
                      ]}
                    />
                  }
                >
                  <TimeSeriesChart
                    label={`CPU and memory utilisation, last ${range.label}`}
                    data={charts.data}
                    series={[
                      { key: "cpuMax", label: "CPU (peak)", color: "var(--em-chart-disk)" },
                      { key: "cpu", label: "CPU (avg)", color: "var(--em-chart-cpu)" },
                      { key: "memory", label: "Memory", color: "var(--em-chart-memory)" },
                      ...(charts.hasSwap ? [{ key: "swap", label: "Swap", color: "var(--em-chart-net-down)" }] : []),
                    ]}
                    yDomain={[0, 100]}
                    format={pct}
                    {...common}
                  />
                </Card>
                <Card
                  title="Network"
                  actions={<Legend items={[{ label: "Download", color: "var(--em-chart-net-down)" }, { label: "Upload", color: "var(--em-chart-net-up)" }]} />}
                >
                  <TimeSeriesChart
                    label={`Network traffic, last ${range.label}`}
                    data={charts.data}
                    series={[
                      { key: "netRx", label: "Download", color: "var(--em-chart-net-down)" },
                      { key: "netTx", label: "Upload", color: "var(--em-chart-net-up)" },
                    ]}
                    format={formatBitRate}
                    {...common}
                  />
                </Card>
                <Card
                  title="Disk activity"
                  actions={<Legend items={[{ label: "Read", color: "var(--em-chart-disk)" }, { label: "Write", color: "var(--em-chart-cpu)" }]} />}
                >
                  <TimeSeriesChart
                    label={`Disk read and write rate, last ${range.label}`}
                    data={charts.data}
                    series={[
                      { key: "diskRead", label: "Read", color: "var(--em-chart-disk)" },
                      { key: "diskWrite", label: "Write", color: "var(--em-chart-cpu)" },
                    ]}
                    format={formatByteRate}
                    {...common}
                  />
                </Card>
                {charts.hasGpu && (
                  <Card title="GPU" subtitle="Busiest adapter">
                    <TimeSeriesChart
                      label={`GPU utilisation, last ${range.label}`}
                      data={charts.data}
                      series={[{ key: "gpu", label: "GPU", color: "var(--em-chart-gpu)" }]}
                      yDomain={[0, 100]}
                      format={pct}
                      {...common}
                    />
                  </Card>
                )}
                {charts.volumes.series.length > 0 && (
                  <Card
                    title="Storage used"
                    subtitle="Recorded once per minute"
                    actions={<Legend items={charts.volumes.series.map((s, i) => ({ label: s.mountPoint, color: VOLUME_COLORS[i % VOLUME_COLORS.length]! }))} />}
                  >
                    <TimeSeriesChart
                      label={`Storage used per volume, last ${range.label}`}
                      data={charts.volumes.data}
                      series={charts.volumes.series.map((s, i) => ({ key: s.key, label: s.mountPoint, color: VOLUME_COLORS[i % VOLUME_COLORS.length]! }))}
                      yDomain={[0, 100]}
                      format={pct}
                      {...common}
                    />
                  </Card>
                )}
              </>
            )}
          </div>
          <div className="content-start">
            <HistorySettingsCard info={history.info} onChanged={history.reload} />
          </div>
        </div>
      )}
    </>
  );
}
