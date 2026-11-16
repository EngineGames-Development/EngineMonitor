import { AvailabilityBadge, Badge, Card, EmptyState, Meter } from "../../design";
import type { VolumeSample } from "../../ipc/types";
import { formatByteRate, formatBytes, formatPercent, UNAVAILABLE } from "../../lib/format";
import { readingAvailability } from "../../metrics/availability";

const KIND_LABEL = { ssd: "SSD", hdd: "HDD", unknown: null } as const;

export function volumeTitle(v: VolumeSample): string {
  return v.name ? `${v.name} (${v.mountPoint})` : v.mountPoint;
}

function IoLine({ volume }: { volume: VolumeSample }) {
  if (volume.io.status !== "ok") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <AvailabilityBadge availability={readingAvailability(volume.io)} />
        I/O activity
      </span>
    );
  }
  const { readBytesPerSec: r, writeBytesPerSec: w } = volume.io.value;
  return (
    <span className="tabular text-xs text-fg-muted">
      Read {r === null ? UNAVAILABLE : formatByteRate(r)} · Write {w === null ? UNAVAILABLE : formatByteRate(w)}
    </span>
  );
}

export function StorageCard({ volumes }: { volumes: readonly VolumeSample[] }) {
  return (
    <Card title="Storage devices" subtitle={`${volumes.length} mounted volume${volumes.length === 1 ? "" : "s"}`}>
      {volumes.length === 0 ? (
        <EmptyState icon="storage" title="No volumes reported" description="The operating system did not report any mounted volumes." />
      ) : (
        <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
          {volumes.map((v) => {
            const kind = KIND_LABEL[v.kind];
            return (
              <li key={v.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="selectable truncate text-sm font-medium text-fg">{volumeTitle(v)}</span>
                    {kind && <Badge>{kind}</Badge>}
                    {v.fileSystem && <Badge>{v.fileSystem}</Badge>}
                    {v.removable && <Badge tone="info">Removable</Badge>}
                    {v.readOnly && <Badge tone="warning">Read-only</Badge>}
                  </div>
                  <span className="tabular shrink-0 text-sm text-fg">
                    {v.usagePercent === null ? UNAVAILABLE : `${formatPercent(v.usagePercent)} %`}
                  </span>
                </div>
                {v.usagePercent !== null && (
                  <Meter className="mt-2" value={v.usagePercent} baseTone="secondary" label={`${volumeTitle(v)} used`} />
                )}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="tabular text-xs text-fg-muted">
                    {formatBytes(v.availableBytes)} free of {formatBytes(v.totalBytes)}
                  </span>
                  <IoLine volume={v} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
