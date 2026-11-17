import { useEffect, useState, type ReactNode } from "react";
import { Card, ErrorState, PageHeader, SegmentedControl, Skeleton, Switch } from "../design";
import { getAppInfo, getHistoryStatus, getLaunchAtLogin, setLaunchAtLogin } from "../ipc/commands";
import type { AppError } from "../ipc/errors";
import type { AppSettings, MetricVisibility, NetworkUnit } from "../ipc/types";
import { useCommand } from "../ipc/useCommand";
import { routeById } from "../navigation/routes";
import { useSettings } from "../settings/SettingsProvider";
import type { ThemePreference } from "../theme/theme";
import { HistorySettingsCard } from "./history/HistorySettingsCard";

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "system", label: "System", icon: "monitor" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: "moon" | "sun" | "monitor" }>;

const UNIT_OPTIONS = [
  { value: "bits", label: "Bits (Mbit/s)" },
  { value: "bytes", label: "Bytes (MiB/s)" },
] as const satisfies ReadonlyArray<{ value: NetworkUnit; label: string }>;

const REFRESH_OPTIONS = [500, 1000, 2000, 5000, 10000] as const;
const WINDOW_OPTIONS = [60, 300, 900, 1800, 3600] as const;

const VISIBILITY_LABELS: Record<keyof MetricVisibility, string> = {
  gpu: "GPU",
  disk: "Disk activity",
  network: "Network",
  storage: "Storage devices",
};

function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

const selectClass =
  "h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg focus:border-primary focus:outline-none";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="selectable tabular text-right font-mono text-xs text-fg">{value}</dd>
    </div>
  );
}

function AboutCard() {
  const info = useCommand(getAppInfo);
  return (
    <Card title="Application" subtitle="Reported by the running backend">
      {info.status === "loading" && (
        <div className="space-y-2.5 py-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
      {info.status === "error" && <ErrorState title="Backend unavailable" message={info.error.message} onRetry={info.reload} />}
      {info.status === "ready" && (
        <dl>
          <InfoRow label="Product" value={info.value.name} />
          <InfoRow label="Version" value={info.value.version} />
          <InfoRow label="Tauri runtime" value={info.value.tauriVersion} />
          <InfoRow label="Platform" value={`${info.value.targetOs} / ${info.value.targetArch}`} />
          <InfoRow label="Build" value={info.value.debugBuild ? "debug" : "release"} />
        </dl>
      )}
      <p className="mt-3 text-xs text-fg-subtle">
        EngineMonitor makes no network requests and sends no data anywhere. All history and settings stay on this
        computer.
      </p>
    </Card>
  );
}

function LaunchAtLoginRow() {
  const [state, setState] = useState<{ enabled: boolean | null; error: AppError | null; busy: boolean }>({
    enabled: null,
    error: null,
    busy: true,
  });
  useEffect(() => {
    let active = true;
    getLaunchAtLogin().then((r) => {
      if (active) setState({ enabled: r.ok ? r.value : null, error: r.ok ? null : r.error, busy: false });
    });
    return () => {
      active = false;
    };
  }, []);

  async function toggle(next: boolean) {
    setState((s) => ({ ...s, busy: true, error: null }));
    const r = await setLaunchAtLogin(next);
    setState((s) => (r.ok ? { enabled: r.value, error: null, busy: false } : { ...s, error: r.error, busy: false }));
  }

  return (
    <Row
      label="Launch at login"
      hint={
        state.error ? (
          <span role="alert" className="text-danger">
            {state.error.message}
          </span>
        ) : (
          "Adds EngineMonitor to your login items (current user only, no administrator rights)."
        )
      }
    >
      <Switch
        label="Launch at login"
        checked={state.enabled ?? false}
        disabled={state.busy || state.enabled === null}
        onChange={toggle}
      />
    </Row>
  );
}

function HistoryCard() {
  const status = useCommand(getHistoryStatus);
  if (status.status === "loading") return <Skeleton className="h-64" />;
  if (status.status === "error") {
    return (
      <Card title="Recording & retention">
        <ErrorState title="History unavailable" message={status.error.message} onRetry={status.reload} />
      </Card>
    );
  }
  return <HistorySettingsCard info={status.value} onChanged={status.reload} />;
}

export function SettingsPage() {
  const { settings, source, update } = useSettings();
  const [error, setError] = useState<AppError | null>(null);
  const [saving, setSaving] = useState(false);

  async function change(patch: Partial<AppSettings>) {
    setSaving(true);
    const err = await update(patch);
    setSaving(false);
    setError(err);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description={routeById("settings").description}
        actions={
          <span role="status" className="text-xs text-fg-subtle">
            {saving ? "Saving…" : source === "local" ? "Not saved: backend unavailable" : "Changes are saved automatically"}
          </span>
        }
      />
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-fg">
          Could not save: {error.message}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-4">
          <Card title="Appearance">
            <Row label="Theme" hint="System follows your operating system's light/dark setting.">
              <SegmentedControl label="Theme" value={settings.theme} options={THEME_OPTIONS} onChange={(theme) => change({ theme })} />
            </Row>
            <Row label="Smooth chart lines" hint="Off draws straight segments between samples.">
              <Switch label="Smooth chart lines" checked={settings.smoothCharts} onChange={(smoothCharts) => change({ smoothCharts })} />
            </Row>
          </Card>

          <Card title="Monitoring">
            <Row
              htmlFor="refresh-interval"
              label="Refresh interval"
              hint="Applies immediately. While the window is minimised, EngineMonitor samples at most every 5 s."
            >
              <select
                id="refresh-interval"
                className={selectClass}
                value={settings.refreshIntervalMs}
                onChange={(e) => change({ refreshIntervalMs: Number(e.target.value) })}
              >
                {REFRESH_OPTIONS.map((ms) => (
                  <option key={ms} value={ms}>
                    {ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}
                  </option>
                ))}
              </select>
            </Row>
            <Row htmlFor="live-window" label="Live graph window" hint="How much time the real-time graphs show.">
              <select
                id="live-window"
                className={selectClass}
                value={settings.liveWindowSecs}
                onChange={(e) => change({ liveWindowSecs: Number(e.target.value) })}
              >
                {WINDOW_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s < 3600 ? `${s / 60} min` : "1 hour"}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Network units">
              <SegmentedControl
                label="Network units"
                value={settings.networkUnit}
                options={UNIT_OPTIONS}
                onChange={(networkUnit) => change({ networkUnit })}
              />
            </Row>
          </Card>

          <Card title="Overview sections" subtitle="CPU and memory are always shown.">
            {(Object.keys(VISIBILITY_LABELS) as (keyof MetricVisibility)[]).map((key) => (
              <Row key={key} label={VISIBILITY_LABELS[key]}>
                <Switch
                  label={`Show ${VISIBILITY_LABELS[key]} on the Overview`}
                  checked={settings.visible[key]}
                  onChange={(on) => change({ visible: { ...settings.visible, [key]: on } })}
                />
              </Row>
            ))}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <HistoryCard />
          <Card title="Startup">
            <LaunchAtLoginRow />
            <Row label="Start minimised" hint="Open in the taskbar instead of on screen. Takes effect on next launch.">
              <Switch label="Start minimised" checked={settings.startMinimized} onChange={(startMinimized) => change({ startMinimized })} />
            </Row>
          </Card>
          <AboutCard />
        </div>
      </div>
    </>
  );
}
