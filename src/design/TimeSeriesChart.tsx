import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Series<K extends string> {
  key: K;
  label: string;
  /** CSS colour, normally a chart token such as `var(--em-chart-cpu)`. */
  color: string;
}

export interface TimeSeriesChartProps<K extends string, D extends { t: number } & Partial<Record<K, number | null>>> {
  data: readonly D[];
  series: ReadonlyArray<Series<K>>;
  /** Fixed y-range (e.g. [0, 100] for percentages); omitted = auto from 0. */
  yDomain?: [number, number];
  /** Formats values for the axis and tooltip. */
  format: (value: number) => string;
  height: number;
  /** Visible time window in ms; the x-axis always ends at the newest point. */
  windowMs?: number;
  /** Compact sparkline: no axes, grid or tooltip. */
  sparkline?: boolean;
  /** Accessible description of what the chart shows. */
  label: string;
}

function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Real-time area chart. Animation is disabled because data changes every
 * tick; `null` values render as gaps (connectNulls=false), never as zero.
 */
export function TimeSeriesChart<K extends string, D extends { t: number } & Partial<Record<K, number | null>>>({
  data,
  series,
  yDomain,
  format,
  height,
  windowMs = 5 * 60_000,
  sparkline = false,
  label,
}: TimeSeriesChartProps<K, D>) {
  const gradientBase = useId().replace(/:/g, "");
  const newest = data.length > 0 ? data[data.length - 1]!.t : 0;
  const xDomain: [number, number] = [newest - windowMs, newest];

  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <AreaChart
          data={data as D[]}
          margin={sparkline ? { top: 2, right: 0, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${gradientBase}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={sparkline ? 0.28 : 0.32} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {!sparkline && <CartesianGrid stroke="var(--em-chart-grid)" vertical={false} />}
          <XAxis
            dataKey="t"
            type="number"
            domain={xDomain}
            allowDataOverflow
            hide={sparkline}
            tickFormatter={formatClock}
            tick={{ fill: "var(--em-fg-subtle)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
          />
          <YAxis
            domain={yDomain ?? [0, "auto"]}
            hide={sparkline}
            width={64}
            tickFormatter={format}
            tick={{ fill: "var(--em-fg-subtle)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickCount={5}
          />
          {!sparkline && (
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(t) => formatClock(Number(t))}
              formatter={(v, name) => [typeof v === "number" ? format(v) : "—", name]}
              contentStyle={{
                background: "var(--em-overlay)",
                border: "1px solid var(--em-line-strong)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--em-fg)",
              }}
              labelStyle={{ color: "var(--em-fg-muted)" }}
              cursor={{ stroke: "var(--em-line-strong)" }}
            />
          )}
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="monotone"
              stroke={s.color}
              strokeWidth={sparkline ? 1.5 : 1.75}
              fill={`url(#${gradientBase}-${s.key})`}
              isAnimationActive={false}
              connectNulls={false}
              dot={false}
              activeDot={sparkline ? false : { r: 3, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
