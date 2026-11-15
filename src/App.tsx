import { AppShell } from "./layout/AppShell";
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
      <NavigationProvider>
        <AppShell>
          <CurrentPage />
        </AppShell>
      </NavigationProvider>
    </ThemeProvider>
  );
}
