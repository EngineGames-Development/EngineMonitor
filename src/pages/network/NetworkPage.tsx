import { Badge, Card, TimeSeriesChart } from "../../design";
import type { InterfaceSample } from "../../ipc/types";
import { formatBytes, UNAVAILABLE } from "../../lib/format";
import { useSettings } from "../../settings/SettingsProvider";
import { useNetworkFormat } from "../../settings/useFormatters";
import { formatWindow } from "../../lib/format";
import { Legend, LivePage, StatStrip } from "../shared";

const DOWN = "var(--em-chart-net-down)";
const UP = "var(--em-chart-net-up)";

const STATE_TONE = { up: "success", down: "neutral", unknown: "warning" } as const;

function linkSpeed(bps: number | null): string {
  if (bps === null) return UNAVAILABLE;
  return bps >= 1e9 ? `${(bps / 1e9).toFixed(bps % 1e9 === 0 ? 0 : 1)} Gbit/s` : `${Math.round(bps / 1e6)} Mbit/s`;
}

function InterfaceRow({ iface }: { iface: InterfaceSample }) {
  const net = useNetworkFormat();
  return (
    <tr className="border-b border-line/60 align-top last:border-b-0">
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          <span className="selectable font-medium text-fg">{iface.name}</span>
          <Badge tone={STATE_TONE[iface.state]} dot>
            {iface.state === "up" ? "Up" : iface.state === "down" ? "Down" : "Unknown"}
          </Badge>
          {iface.loopback && <Badge>Loopback</Badge>}
        </div>
        <div className="selectable mt-1 space-y-0.5 font-mono text-2xs text-fg-subtle">
          {iface.addresses.length === 0 ? <div>No addresses</div> : iface.addresses.map((a) => <div key={a}>{a}</div>)}
          {iface.macAddress && <div>MAC {iface.macAddress}</div>}
        </div>
      </td>
      <td className="tabular py-2.5 pr-4 text-right text-fg">
        {iface.receiveBytesPerSec === null ? UNAVAILABLE : net.format(iface.receiveBytesPerSec)}
      </td>
      <td className="tabular py-2.5 pr-4 text-right text-fg">
        {iface.transmitBytesPerSec === null ? UNAVAILABLE : net.format(iface.transmitBytesPerSec)}
      </td>
      <td className="tabular py-2.5 pr-4 text-right text-fg-muted">
        {formatBytes(iface.totalReceivedBytes)} / {formatBytes(iface.totalTransmittedBytes)}
      </td>
      <td className="tabular py-2.5 pr-4 text-right text-fg-muted">{linkSpeed(iface.linkSpeedBps)}</td>
      <td className="tabular py-2.5 text-right text-fg-muted">{iface.mtu ?? UNAVAILABLE}</td>
    </tr>
  );
}

export function NetworkPage() {
  const net = useNetworkFormat();
  const { settings } = useSettings();
  return (
    <LivePage route="network">
      {({ snapshot, history }) => {
        const nw = snapshot.network;
        const up = nw.interfaces.filter((i) => i.state === "up" && !i.loopback).length;
        return (
          <div className="space-y-4">
            <StatStrip
              items={[
                { label: "Download", value: nw.receiveBytesPerSec === null ? UNAVAILABLE : net.format(nw.receiveBytesPerSec), hint: "All non-loopback interfaces" },
                { label: "Upload", value: nw.transmitBytesPerSec === null ? UNAVAILABLE : net.format(nw.transmitBytesPerSec) },
                { label: "Interfaces", value: nw.interfaces.length, hint: `${up} up` },
                {
                  label: "Received / sent",
                  value: formatBytes(nw.interfaces.filter((i) => !i.loopback).reduce((s, i) => s + i.totalReceivedBytes, 0)),
                  hint: `${formatBytes(nw.interfaces.filter((i) => !i.loopback).reduce((s, i) => s + i.totalTransmittedBytes, 0))} sent (OS counters)`,
                },
              ]}
            />
            <Card
              title="Traffic"
              subtitle={`Last ${formatWindow(settings.liveWindowSecs)}`}
              actions={<Legend items={[{ label: "Download", color: DOWN }, { label: "Upload", color: UP }]} />}
            >
              <TimeSeriesChart
                label={`Network download and upload rate over the last ${formatWindow(settings.liveWindowSecs)}`}
                data={history}
                series={[
                  { key: "rx", label: "Download", color: DOWN },
                  { key: "tx", label: "Upload", color: UP },
                ]}
                format={net.format}
                height={200}
              />
            </Card>
            <Card title="Interfaces" flush>
              <div className="overflow-x-auto px-4 pb-2">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs tracking-wide text-fg-muted uppercase">
                      <th scope="col" className="py-2 pr-4 text-left font-medium">Interface</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Download</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Upload</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Received / sent</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Link</th>
                      <th scope="col" className="py-2 text-right font-medium">MTU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nw.interfaces.map((i) => (
                      <InterfaceRow key={i.name} iface={i} />
                    ))}
                  </tbody>
                </table>
                {nw.interfaces.length === 0 && <p className="py-6 text-center text-sm text-fg-muted">No interfaces reported.</p>}
              </div>
            </Card>
          </div>
        );
      }}
    </LivePage>
  );
}
