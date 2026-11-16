import { Card, TimeSeriesChart } from "../../design";
import { formatByteRate, formatBytes } from "../../lib/format";
import { sumKnown } from "../../metrics/history";
import { StorageCard } from "../overview/StorageCard";
import { Legend, LivePage, StatStrip } from "../shared";

const READ = "var(--em-chart-disk)";
const WRITE = "var(--em-chart-cpu)";

export function StoragePage() {
  return (
    <LivePage route="storage">
      {({ snapshot, history }) => {
        const volumes = snapshot.storage;
        const total = volumes.reduce((s, v) => s + v.totalBytes, 0);
        const free = volumes.reduce((s, v) => s + v.availableBytes, 0);
        const io = volumes.flatMap((v) => (v.io.status === "ok" ? [v.io.value] : []));
        const read = sumKnown(io.map((d) => d.readBytesPerSec));
        const write = sumKnown(io.map((d) => d.writeBytesPerSec));
        return (
          <div className="space-y-4">
            <StatStrip
              items={[
                { label: "Volumes", value: volumes.length, hint: `${io.length} with I/O counters` },
                { label: "Total capacity", value: formatBytes(total) },
                { label: "Free", value: formatBytes(free) },
                {
                  label: "Read · Write",
                  value: read === null && write === null ? "—" : `${formatByteRate(read ?? 0)} · ${formatByteRate(write ?? 0)}`,
                  hint: io.length === 0 ? "No volume reports I/O counters" : "Across volumes with counters",
                },
              ]}
            />
            <Card
              title="Disk activity"
              subtitle="Volumes that report I/O counters, last 5 minutes"
              actions={<Legend items={[{ label: "Read", color: READ }, { label: "Write", color: WRITE }]} />}
            >
              <TimeSeriesChart
                label="Disk read and write rate over the last 5 minutes"
                data={history}
                series={[
                  { key: "diskRead", label: "Read", color: READ },
                  { key: "diskWrite", label: "Write", color: WRITE },
                ]}
                format={formatByteRate}
                height={200}
              />
            </Card>
            <StorageCard volumes={volumes} />
          </div>
        );
      }}
    </LivePage>
  );
}
