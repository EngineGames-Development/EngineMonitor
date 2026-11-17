import type { ReactNode } from "react";
import { MetricsProvider } from "../metrics/MetricsProvider";
import { SettingsProvider } from "../settings/SettingsProvider";

/** Providers every page needs (test-only). */
export function TestProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <MetricsProvider>{children}</MetricsProvider>
    </SettingsProvider>
  );
}
