import { AppShell } from "./layout/AppShell";
import { MetricsProvider } from "./metrics/MetricsProvider";
import { NavigationProvider, useNavigation } from "./navigation/NavigationProvider";
import { PAGES } from "./pages";
import { ThemeProvider } from "./theme/ThemeProvider";

function CurrentPage() {
  const { current } = useNavigation();
  const Page = PAGES[current];
  return <Page />;
}

export function App() {
  return (
    <ThemeProvider>
      <MetricsProvider>
        <NavigationProvider>
          <AppShell>
            <CurrentPage />
          </AppShell>
        </NavigationProvider>
      </MetricsProvider>
    </ThemeProvider>
  );
}
