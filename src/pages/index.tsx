import type { ReactElement } from "react";
import type { RouteId } from "../navigation/routes";
import { OverviewPage } from "./overview/OverviewPage";
import { PlannedSection } from "./PlannedSection";
import { SettingsPage } from "./SettingsPage";

/**
 * Section registry. Sections that still render `PlannedSection` have no data
 * pipeline yet and show no measurements (see DEVELOPMENT_STATUS.md).
 */
export const PAGES: Record<RouteId, () => ReactElement> = {
  overview: () => <OverviewPage />,
  cpu: () => (
    <PlannedSection
      route="cpu"
      milestone={2}
      features={[
        "Overall and per-core utilisation",
        "Model, logical and physical core counts",
        "Frequency and load average where the OS provides them",
        "Utilisation history graph",
      ]}
    />
  ),
  memory: () => (
    <PlannedSection
      route="memory"
      milestone={2}
      features={["Total, used and available memory", "Utilisation percentage", "Swap usage", "Memory history graph"]}
    />
  ),
  gpu: () => (
    <PlannedSection
      route="gpu"
      milestone={4}
      features={[
        "Provider architecture (NVML for NVIDIA, PDH/DXGI on Windows)",
        "Model, utilisation, VRAM usage and temperature where exposed",
        "Explicit 'unsupported' state instead of guessed values",
      ]}
    />
  ),
  processes: () => (
    <PlannedSection
      route="processes"
      milestone={4}
      features={[
        "Name, PID, CPU, memory, executable path and status",
        "Search, sorting, filtering and a virtualised table",
        "Process detail view",
        "Termination with explicit confirmation and OS permission checks",
      ]}
    />
  ),
  storage: () => (
    <PlannedSection
      route="storage"
      milestone={2}
      features={["Mounted volumes and file systems", "Total, used and available capacity", "Disk read/write activity where supported"]}
    />
  ),
  network: () => (
    <PlannedSection
      route="network"
      milestone={2}
      features={[
        "Interface discovery and details",
        "Upload/download speed from counter deltas over measured time",
        "Totals received and transmitted, with counter-reset handling",
        "Traffic history graph",
      ]}
    />
  ),
  history: () => (
    <PlannedSection
      route="history"
      milestone={5}
      features={[
        "SQLite persistence with a configurable sampling interval",
        "CPU, memory, network and storage history graphs",
        "Retention policy and automatic cleanup",
      ]}
    />
  ),
  settings: () => <SettingsPage />,
};
