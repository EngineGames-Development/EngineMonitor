import { AvailabilityBadge, Card, EmptyState, ErrorState, Meter, TimeSeriesChart } from "../../design";
import type { ReactNode } from "react";
import type { GpuSample, Reading } from "../../ipc/types";
import { formatBytes, formatPercent } from "../../lib/format";
import { readingAvailability } from "../../metrics/availability";
import { LivePage } from "../shared";

const pct = (v: number) => `${formatPercent(v)} %`;

function ReadingValue<T>({ reading, format }: { reading: Reading<T>; format: (v: T) => string }) {
  return reading.status === "ok" ? (
    <span className="tabular text-fg">{format(reading.value)}</span>
  ) : (
    <AvailabilityBadge availability={readingAvailability(reading)} />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

export function GpuAdapterCard({ gpu }: { gpu: GpuSample }) {
  const usage = gpu.usagePercent.status === "ok" ? gpu.usagePercent.value : null;
  return (
    <Card title={gpu.model ?? "Unknown adapter"} subtitle={[gpu.vendor, `via ${gpu.provider}`].filter(Boolean).join(" · ")}>
      <Field label="Utilisation">
        <ReadingValue reading={gpu.usagePercent} format={pct} />
      </Field>
      {usage !== null && <Meter value={usage} baseTone="info" label={`${gpu.model ?? "GPU"} utilisation`} />}
      <Field label="Dedicated memory">
        {gpu.memoryUsedBytes.status === "ok" && gpu.memoryTotalBytes.status === "ok" ? (
          <span className="tabular text-fg">
            {formatBytes(gpu.memoryUsedBytes.value)} / {formatBytes(gpu.memoryTotalBytes.value)}
          </span>
        ) : (
          <ReadingValue reading={gpu.memoryTotalBytes} format={formatBytes} />
        )}
      </Field>
      {gpu.memoryUsagePercent !== null && (
        <Meter value={gpu.memoryUsagePercent} baseTone="secondary" label={`${gpu.model ?? "GPU"} memory used`} />
      )}
      <Field label="Temperature">
        <ReadingValue reading={gpu.temperatureCelsius} format={(c) => `${c.toFixed(0)} °C`} />
      </Field>
    </Card>
  );
}

export function GpuPage() {
  return (
    <LivePage route="gpu">
      {({ snapshot, history }) => {
        const gpu = snapshot.gpu;
        if (gpu.status === "pending") {
          return <EmptyState icon="gpu" title="Measuring" description="GPU utilisation needs two samples." />;
        }
        if (gpu.status === "unsupported") {
          return (
            <Card>
              <EmptyState icon="gpu" title="GPU monitoring is not supported here" description={gpu.reason} />
            </Card>
          );
        }
        if (gpu.status === "error") {
          return (
            <Card>
              <ErrorState title="GPU monitoring failed" message={gpu.message} />
            </Card>
          );
        }
        if (gpu.value.length === 0) {
          return (
            <Card>
              <EmptyState icon="gpu" title="No GPU found" description="The operating system reported no hardware graphics adapter." />
            </Card>
          );
        }
        return (
          <div className="space-y-4">
            <Card
              title="Utilisation"
              subtitle={gpu.value.length > 1 ? "Busiest adapter, last 5 minutes" : "Last 5 minutes"}
            >
              <TimeSeriesChart
                label="GPU utilisation over the last 5 minutes"
                data={history}
                series={[{ key: "gpu", label: "GPU", color: "var(--em-chart-gpu)" }]}
                yDomain={[0, 100]}
                format={pct}
                height={200}
              />
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              {gpu.value.map((g) => (
                <GpuAdapterCard key={g.id} gpu={g} />
              ))}
            </div>
            <p className="text-xs text-fg-subtle">
              {gpu.value.some((g) => g.provider === "windows-pdh")
                ? "Utilisation is the busiest engine type (3D, video, copy, …), as in Windows Task Manager. "
                : ""}
              Memory shows dedicated video memory only; shared system memory is not included.
            </p>
          </div>
        );
      }}
    </LivePage>
  );
}
