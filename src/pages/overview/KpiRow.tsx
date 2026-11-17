import { cx, StatTile, TimeSeriesChart } from "../../design";
import type { Snapshot } from "../../ipc/types";
import { formatByteRate, formatBytes, formatPercent, splitByteRate, UNAVAILABLE } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { useNetworkFormat } from "../../settings/useFormatters";
import { sumKnown, type HistoryPoint } from "../../metrics/history";

const SPARK_HEIGHT = 44;
const SPARK_WINDOW_MS = 60_000;

const XL_COLS: Record<number, string> = { 2: "xl:grid-cols-2", 3: "xl:grid-cols-3", 4: "xl:grid-cols-4" };

const percentFmt = (v: number) => `${formatPercent(v)} %`;

export function KpiRow({ snapshot, history }: { snapshot: Snapshot; history: readonly HistoryPoint[] }) {
  const { cpu, memory, network, storage } = snapshot;
  const net = useNetworkFormat();
  const { visible } = useSettings().settings;
  const count = 2 + (visible.disk ? 1 : 0) + (visible.network ? 1 : 0);

  const ioVolumes = storage.filter((v) => v.io.status === "ok");
  const diskRead = sumKnown(ioVolumes.map((v) => (v.io.status === "ok" ? v.io.value.readBytesPerSec : null)));
  const diskWrite = sumKnown(ioVolumes.map((v) => (v.io.status === "ok" ? v.io.value.writeBytesPerSec : null)));
  const diskTotal = sumKnown([diskRead, diskWrite]);
  const disk = diskTotal === null ? { value: UNAVAILABLE, unit: "" } : splitByteRate(diskTotal);

  const down = network.receiveBytesPerSec === null ? { value: UNAVAILABLE, unit: "" } : net.split(network.receiveBytesPerSec);

  return (
    <div className={cx("grid gap-4 sm:grid-cols-2", XL_COLS[count])}>
      <StatTile
        label="CPU"
        icon="cpu"
        accent="var(--em-chart-cpu)"
        value={cpu.usagePercent === null ? UNAVAILABLE : formatPercent(cpu.usagePercent)}
        unit={cpu.usagePercent === null ? undefined : "%"}
        hint={cpu.usagePercent === null ? "Measuring — needs two samples" : `${cpu.cores.length} logical cores`}
      >
        <TimeSeriesChart
          label="CPU utilisation, last minute"
          data={history}
          series={[{ key: "cpu", label: "CPU", color: "var(--em-chart-cpu)" }]}
          yDomain={[0, 100]}
          format={percentFmt}
          height={SPARK_HEIGHT}
          windowMs={SPARK_WINDOW_MS}
          sparkline
        />
      </StatTile>

      <StatTile
        label="Memory"
        icon="memory"
        accent="var(--em-chart-memory)"
        value={memory.usagePercent === null ? UNAVAILABLE : formatPercent(memory.usagePercent)}
        unit={memory.usagePercent === null ? undefined : "%"}
        hint={`${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}`}
      >
        <TimeSeriesChart
          label="Memory utilisation, last minute"
          data={history}
          series={[{ key: "memory", label: "Memory", color: "var(--em-chart-memory)" }]}
          yDomain={[0, 100]}
          format={percentFmt}
          height={SPARK_HEIGHT}
          windowMs={SPARK_WINDOW_MS}
          sparkline
        />
      </StatTile>

      {visible.disk && (
        <StatTile
          label="Disk activity"
          icon="storage"
          accent="var(--em-chart-disk)"
          value={disk.value}
          unit={disk.unit || undefined}
          hint={
            ioVolumes.length === 0
              ? "No volume reports I/O counters"
              : diskTotal === null
                ? "Measuring — needs two samples"
                : `Read ${formatByteRate(diskRead ?? 0)} · Write ${formatByteRate(diskWrite ?? 0)}`
          }
        >
          <TimeSeriesChart
            label="Disk read and write rate, last minute"
            data={history}
            series={[
              { key: "diskRead", label: "Read", color: "var(--em-chart-disk)" },
              { key: "diskWrite", label: "Write", color: "var(--em-chart-cpu)" },
            ]}
            format={formatByteRate}
            height={SPARK_HEIGHT}
            windowMs={SPARK_WINDOW_MS}
            sparkline
          />
        </StatTile>
      )}

      {visible.network && (
        <StatTile
          label="Network"
          icon="network"
          accent="var(--em-chart-net-down)"
          value={down.value}
          unit={down.unit || undefined}
          hint={
            network.transmitBytesPerSec === null
              ? "Measuring — needs two samples"
              : `Download · Upload ${net.format(network.transmitBytesPerSec)}`
          }
        >
          <TimeSeriesChart
            label="Network download and upload rate, last minute"
            data={history}
            series={[
              { key: "rx", label: "Download", color: "var(--em-chart-net-down)" },
              { key: "tx", label: "Upload", color: "var(--em-chart-net-up)" },
            ]}
            format={net.format}
            height={SPARK_HEIGHT}
            windowMs={SPARK_WINDOW_MS}
            sparkline
          />
        </StatTile>
      )}
    </div>
  );
}
