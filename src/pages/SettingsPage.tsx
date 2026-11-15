import type { ReactNode } from "react";
import { AvailabilityBadge, Button, Card, ErrorState, PageHeader, SegmentedControl, Skeleton } from "../design";
import { getAppInfo } from "../ipc/commands";
import { useCommand } from "../ipc/useCommand";
import { routeById } from "../navigation/routes";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemePreference } from "../theme/theme";

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "system", label: "System", icon: "monitor" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: "moon" | "sun" | "monitor" }>;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

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
          <Skeleton className="h-4 w-3/5" />
        </div>
      )}
      {info.status === "error" && (
        <ErrorState title="Backend unavailable" message={info.error.message} onRetry={info.reload} />
      )}
      {info.status === "ready" && (
        <dl>
          <InfoRow label="Product" value={info.value.name} />
          <InfoRow label="Version" value={info.value.version} />
          <InfoRow label="Tauri runtime" value={info.value.tauriVersion} />
          <InfoRow label="Platform" value={`${info.value.targetOs} / ${info.value.targetArch}`} />
          <InfoRow label="Build" value={info.value.debugBuild ? "debug" : "release"} />
        </dl>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const { preference, setPreference } = useTheme();
  return (
    <>
      <PageHeader title="Settings" description={routeById("settings").description} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Appearance">
          <Row label="Theme" hint="System follows your operating system's light/dark setting.">
            <SegmentedControl label="Theme" value={preference} options={THEME_OPTIONS} onChange={setPreference} />
          </Row>
        </Card>

        <AboutCard />

        <Card
          title="Monitoring & data"
          actions={<AvailabilityBadge availability={{ state: "notImplemented", milestone: 6 }} />}
          className="xl:col-span-2"
        >
          <p className="text-sm text-fg-muted">
            Refresh interval, graph preferences, history retention, startup behaviour and metric visibility will be
            configurable here once the sampler (milestone 3) and the SQLite settings store (milestones 5–6) exist.
            The theme above is already persisted between launches.
          </p>
          <div className="mt-3">
            <Button size="sm" disabled>
              Not available yet
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
