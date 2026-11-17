import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSettings } from "../settings/SettingsProvider";
import { resolveTheme, type ResolvedTheme, type ThemePreference } from "./theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY).matches
    : true;
}

/**
 * Applies the theme from the persisted settings to `<html data-theme>` and
 * follows the OS while "system" is selected. Must be inside SettingsProvider.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const preference = settings.theme;
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback(
    (pref: ThemePreference) => {
      void update({ theme: pref }).then((err) => {
        if (err) console.warn("EngineMonitor: could not save theme", err.message);
      });
    },
    [update],
  );

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
