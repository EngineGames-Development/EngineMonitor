import type { ReactNode } from "react";
import { Card } from "../../design";
import type { Snapshot, SystemInfo } from "../../ipc/types";
import { formatBytes, formatDuration, UNAVAILABLE } from "../../lib/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-fg-muted">{label}</dt>
      <dd className="selectable tabular min-w-0 truncate text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

export function coreSummary(info: SystemInfo): string {
  const { logicalCores, physicalCores } = info.cpu;
  if (physicalCores === null) return `${logicalCores} logical (physical unknown)`;
  return physicalCores === logicalCores
    ? `${physicalCores} cores`
    : `${physicalCores} cores · ${logicalCores} threads`;
}

export function SystemCard({ info, snapshot }: { info: SystemInfo; snapshot: Snapshot }) {
  const os = info.osLongName ?? ([info.osName, info.osVersion].filter(Boolean).join(" ") || UNAVAILABLE);
  return (
    <Card title="System">
      <dl className="divide-y divide-line">
        <Row label="Operating system">{os}</Row>
        <Row label="Kernel">{info.kernelVersion ?? UNAVAILABLE}</Row>
        <Row label="Processor">
          <span title={info.cpu.brand ?? undefined}>{info.cpu.brand ?? UNAVAILABLE}</span>
        </Row>
        <Row label="Cores">{coreSummary(info)}</Row>
        <Row label="Architecture">{info.cpu.architecture}</Row>
        <Row label="Installed memory">{formatBytes(info.totalMemoryBytes)}</Row>
        <Row label="Uptime">{snapshot.uptimeSecs === null ? UNAVAILABLE : formatDuration(snapshot.uptimeSecs)}</Row>
      </dl>
    </Card>
  );
}
