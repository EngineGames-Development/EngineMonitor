import type { ReactElement } from "react";
import type { RouteId } from "../navigation/routes";
import { CpuPage } from "./cpu/CpuPage";
import { GpuPage } from "./gpu/GpuPage";
import { MemoryPage } from "./memory/MemoryPage";
import { NetworkPage } from "./network/NetworkPage";
import { OverviewPage } from "./overview/OverviewPage";
import { PlannedSection } from "./PlannedSection";
import { ProcessesPage } from "./processes/ProcessesPage";
import { SettingsPage } from "./SettingsPage";
import { StoragePage } from "./storage/StoragePage";

/**
 * Section registry. Sections that still render `PlannedSection` have no data
 * pipeline yet and show no measurements (see DEVELOPMENT_STATUS.md).
 */
export const PAGES: Record<RouteId, () => ReactElement> = {
  overview: () => <OverviewPage />,
  cpu: () => <CpuPage />,
  memory: () => <MemoryPage />,
  gpu: () => <GpuPage />,
  processes: () => <ProcessesPage />,
  storage: () => <StoragePage />,
  network: () => <NetworkPage />,
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
