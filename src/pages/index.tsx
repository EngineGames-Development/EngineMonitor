import type { ReactElement } from "react";
import type { RouteId } from "../navigation/routes";
import { CpuPage } from "./cpu/CpuPage";
import { GpuPage } from "./gpu/GpuPage";
import { HistoryPage } from "./history/HistoryPage";
import { MemoryPage } from "./memory/MemoryPage";
import { NetworkPage } from "./network/NetworkPage";
import { OverviewPage } from "./overview/OverviewPage";
import { ProcessesPage } from "./processes/ProcessesPage";
import { SettingsPage } from "./SettingsPage";
import { StoragePage } from "./storage/StoragePage";

/** Section registry: one page per sidebar route. */
export const PAGES: Record<RouteId, () => ReactElement> = {
  overview: () => <OverviewPage />,
  cpu: () => <CpuPage />,
  memory: () => <MemoryPage />,
  gpu: () => <GpuPage />,
  processes: () => <ProcessesPage />,
  storage: () => <StoragePage />,
  network: () => <NetworkPage />,
  history: () => <HistoryPage />,
  settings: () => <SettingsPage />,
};
