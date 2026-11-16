import { Card, Meter, TimeSeriesChart } from "../../design";
import { formatBytes, formatPercent, UNAVAILABLE } from "../../lib/format";
import { LivePage, StatStrip } from "../shared";

const pct = (v: number) => `${formatPercent(v)} %`;

export function MemoryPage() {
  return (
    <LivePage route="memory">
      {({ snapshot, history }) => {
        const m = snapshot.memory;
        const hasSwap = m.swapTotalBytes > 0;
        return (
          <div className="space-y-4">
            <StatStrip
              items={[
                { label: "In use", value: formatBytes(m.usedBytes), hint: m.usagePercent === null ? undefined : `${pct(m.usagePercent)} of total` },
                { label: "Available", value: formatBytes(m.availableBytes), hint: "Usable without swapping" },
                { label: "Total", value: formatBytes(m.totalBytes), hint: "Visible to the OS" },
                {
                  label: "Swap / page file",
                  value: hasSwap ? `${formatBytes(m.swapUsedBytes)} / ${formatBytes(m.swapTotalBytes)}` : "None",
                  hint: hasSwap ? undefined : "No swap configured",
                },
              ]}
            />

            <Card title="Utilisation" subtitle="Physical memory, last 5 minutes">
              <TimeSeriesChart
                label="Memory utilisation over the last 5 minutes"
                data={history}
                series={[{ key: "memory", label: "Memory", color: "var(--em-chart-memory)" }]}
                yDomain={[0, 100]}
                format={pct}
                height={220}
              />
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Physical memory">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-fg-muted">Used</span>
                  <span className="tabular text-fg">{m.usagePercent === null ? UNAVAILABLE : pct(m.usagePercent)}</span>
                </div>
                {m.usagePercent !== null && (
                  <Meter className="mt-2" value={m.usagePercent} baseTone="secondary" label="Physical memory used" />
                )}
                <p className="tabular mt-2 text-xs text-fg-muted">
                  {formatBytes(m.usedBytes)} used · {formatBytes(m.availableBytes)} available · {formatBytes(m.totalBytes)} total
                </p>
              </Card>
              <Card title="Swap / page file">
                {hasSwap ? (
                  <>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-fg-muted">Used</span>
                      <span className="tabular text-fg">{m.swapUsagePercent === null ? UNAVAILABLE : pct(m.swapUsagePercent)}</span>
                    </div>
                    {m.swapUsagePercent !== null && (
                      <Meter className="mt-2" value={m.swapUsagePercent} baseTone="info" label="Swap used" />
                    )}
                    <p className="tabular mt-2 text-xs text-fg-muted">
                      {formatBytes(m.swapUsedBytes)} of {formatBytes(m.swapTotalBytes)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-fg-muted">No swap space or page file is configured.</p>
                )}
              </Card>
            </div>
          </div>
        );
      }}
    </LivePage>
  );
}
