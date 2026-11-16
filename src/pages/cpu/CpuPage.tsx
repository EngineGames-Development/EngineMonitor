import { AvailabilityBadge, Card, Meter, TimeSeriesChart } from "../../design";
import { formatFrequencyMHz, formatPercent, UNAVAILABLE } from "../../lib/format";
import { readingAvailability } from "../../metrics/availability";
import { coreSummary } from "../overview/SystemCard";
import { LivePage, StatStrip } from "../shared";

const CPU = "var(--em-chart-cpu)";
const pct = (v: number) => `${formatPercent(v)} %`;

export function CpuPage() {
  return (
    <LivePage route="cpu">
      {({ info, snapshot, history }) => {
        const { cpu } = snapshot;
        const load = cpu.loadAverage;
        return (
          <div className="space-y-4">
            <StatStrip
              items={[
                {
                  label: "Utilisation",
                  value: cpu.usagePercent === null ? UNAVAILABLE : pct(cpu.usagePercent),
                  hint: cpu.usagePercent === null ? "Measuring — needs two samples" : "All cores",
                },
                {
                  // Windows reports a nominal value (often the base clock), not
                  // the live boost clock; the label says so.
                  label: "Reported frequency",
                  value: cpu.frequencyMhz === null ? UNAVAILABLE : formatFrequencyMHz(cpu.frequencyMhz),
                  hint: info.osName === "Windows" ? "Windows value, may be base clock" : "Average across cores",
                },
                { label: "Cores", value: coreSummary(info), hint: info.cpu.architecture },
                {
                  label: "Load average (1 · 5 · 15 min)",
                  value:
                    load.status === "ok"
                      ? `${load.value.one.toFixed(2)} · ${load.value.five.toFixed(2)} · ${load.value.fifteen.toFixed(2)}`
                      : UNAVAILABLE,
                  hint: load.status === "ok" ? undefined : <AvailabilityBadge availability={readingAvailability(load)} />,
                },
              ]}
            />

            <Card title="Utilisation" subtitle={info.cpu.brand ?? "Processor"}>
              <TimeSeriesChart
                label="CPU utilisation over the last 5 minutes"
                data={history}
                series={[{ key: "cpu", label: "CPU", color: CPU }]}
                yDomain={[0, 100]}
                format={pct}
                height={220}
              />
            </Card>

            <Card title="Per core" subtitle={`${cpu.cores.length} logical processors`}>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {cpu.cores.map((core, i) => (
                  <li key={i} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-fg-muted">Core {i}</span>
                      <span className="tabular text-fg">{core.usagePercent === null ? UNAVAILABLE : pct(core.usagePercent)}</span>
                    </div>
                    {core.usagePercent !== null && (
                      <Meter className="mt-1.5" size="sm" value={core.usagePercent} label={`Core ${i} utilisation`} />
                    )}
                    <div className="tabular mt-1 text-2xs text-fg-subtle">
                      {core.frequencyMhz === null ? "Frequency unknown" : formatFrequencyMHz(core.frequencyMhz)}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        );
      }}
    </LivePage>
  );
}
