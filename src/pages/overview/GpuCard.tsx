import { AvailabilityBadge, Card, Meter } from "../../design";
import type { Snapshot } from "../../ipc/types";
import { formatBytes, formatPercent } from "../../lib/format";
import { readingAvailability } from "../../metrics/availability";

/** Compact GPU summary for the Overview; details live on the GPU page. */
export function GpuCard({ gpu }: { gpu: Snapshot["gpu"] }) {
  if (gpu.status !== "ok") {
    return (
      <Card title="GPU" actions={<AvailabilityBadge availability={readingAvailability(gpu)} />}>
        <p className="text-sm text-fg-muted">
          {gpu.status === "unsupported" ? gpu.reason : gpu.status === "error" ? gpu.message : "Measuring…"}
        </p>
      </Card>
    );
  }
  if (gpu.value.length === 0) {
    return (
      <Card title="GPU">
        <p className="text-sm text-fg-muted">No hardware graphics adapter reported.</p>
      </Card>
    );
  }
  return (
    <Card title="GPU">
      <ul className="space-y-3">
        {gpu.value.map((g) => (
          <li key={g.id} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-fg" title={g.model ?? undefined}>
                {g.model ?? "Unknown adapter"}
              </span>
              {g.usagePercent.status === "ok" ? (
                <span className="tabular shrink-0 text-sm text-fg">{formatPercent(g.usagePercent.value)} %</span>
              ) : (
                <AvailabilityBadge availability={readingAvailability(g.usagePercent)} />
              )}
            </div>
            {g.usagePercent.status === "ok" && (
              <Meter className="mt-1.5" size="sm" value={g.usagePercent.value} baseTone="info" label={`${g.model ?? "GPU"} utilisation`} />
            )}
            <div className="tabular mt-1 text-xs text-fg-subtle">
              {g.memoryUsedBytes.status === "ok" && g.memoryTotalBytes.status === "ok"
                ? `${formatBytes(g.memoryUsedBytes.value)} of ${formatBytes(g.memoryTotalBytes.value)} dedicated`
                : "Dedicated memory not reported"}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
