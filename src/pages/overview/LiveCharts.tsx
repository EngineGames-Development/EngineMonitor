import { Card, cx, TimeSeriesChart } from "../../design";
import { formatPercent, formatWindow } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { useNetworkFormat } from "../../settings/useFormatters";
import type { HistoryPoint } from "../../metrics/history";

function Legend({ items }: { items: ReadonlyArray<{ label: string; color: string }> }) {
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

const CPU = "var(--em-chart-cpu)";
const MEM = "var(--em-chart-memory)";
const DOWN = "var(--em-chart-net-down)";
const UP = "var(--em-chart-net-up)";

export function LiveCharts({ history, className }: { history: readonly HistoryPoint[]; className?: string }) {
  const net = useNetworkFormat();
  const { settings } = useSettings();
  const windowLabel = formatWindow(settings.liveWindowSecs);
  return (
    <div className={cx("grid content-start gap-4", className)}>
      <Card
        title="CPU & memory"
        subtitle={`Utilisation, last ${windowLabel}`}
        actions={<Legend items={[{ label: "CPU", color: CPU }, { label: "Memory", color: MEM }]} />}
      >
        <TimeSeriesChart
          label={`CPU and memory utilisation over the last ${windowLabel}`}
          data={history}
          series={[
            { key: "cpu", label: "CPU", color: CPU },
            { key: "memory", label: "Memory", color: MEM },
          ]}
          yDomain={[0, 100]}
          format={(v) => `${formatPercent(v)} %`}
          height={200}
        />
      </Card>
      {settings.visible.network && (
        <Card
          title="Network traffic"
          subtitle={`All non-loopback interfaces, last ${windowLabel}`}
          actions={<Legend items={[{ label: "Download", color: DOWN }, { label: "Upload", color: UP }]} />}
        >
          <TimeSeriesChart
            label={`Network download and upload rate over the last ${windowLabel}`}
            data={history}
            series={[
              { key: "rx", label: "Download", color: DOWN },
              { key: "tx", label: "Upload", color: UP },
            ]}
            format={net.format}
            height={180}
          />
        </Card>
      )}
    </div>
  );
}
