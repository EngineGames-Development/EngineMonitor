import { useMemo, type ReactNode } from "react";
import { AppShell } from "./layout/AppShell";
import { MetricsProvider } from "./metrics/MetricsProvider";
import { NavigationProvider, useNavigation } from "./navigation/NavigationProvider";
import { PAGES } from "./pages";
import { SettingsProvider, useSettings } from "./settings/SettingsProvider";
import { ChartPrefsContext } from "./design";
import { ThemeProvider } from "./theme/ThemeProvider";

function CurrentPage() {
  const { current } = useNavigation();
  const Page = PAGES[current];
  return <Page />;
}

function ChartPrefs({ children }: { children: ReactNode }) {
  const { smoothCharts, liveWindowSecs } = useSettings().settings;
  const value = useMemo(() => ({ smooth: smoothCharts, liveWindowMs: liveWindowSecs * 1000 }), [smoothCharts, liveWindowSecs]);
  return <ChartPrefsContext.Provider value={value}>{children}</ChartPrefsContext.Provider>;
}

export function App() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <ChartPrefs>
          <MetricsProvider>
            <NavigationProvider>
              <AppShell>
                <CurrentPage />
              </AppShell>
            </NavigationProvider>
          </MetricsProvider>
        </ChartPrefs>
      </ThemeProvider>
    </SettingsProvider>
  );
}
