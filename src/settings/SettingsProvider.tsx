import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAppSettings, setAppSettings } from "../ipc/commands";
import type { AppError } from "../ipc/errors";
import { DEFAULT_APP_SETTINGS, isAppSettings, type AppSettings } from "../ipc/types";
import { THEME_STORAGE_KEY, readStoredPreference } from "../theme/theme";

export type SettingsSource =
  /** Loaded from (and saved to) the backend's database. */
  | "backend"
  /** Backend unavailable (e.g. plain browser): defaults, changes not persisted. */
  | "local";

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  source: SettingsSource;
  /** Saves a change; resolves with an error instead of throwing. */
  update: (patch: Partial<AppSettings>) => Promise<AppError | null>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Owns the application settings. The backend (SQLite) is the source of
 * truth; the theme is additionally cached in localStorage so the very first
 * paint uses the right theme before the backend has answered.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_APP_SETTINGS,
    theme: readStoredPreference(safeStorage()),
  }));
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<SettingsSource>("backend");

  useEffect(() => {
    let active = true;
    getAppSettings().then((r) => {
      if (!active) return;
      if (r.ok && isAppSettings(r.value)) {
        setSettings(r.value);
        setSource("backend");
      } else {
        if (r.ok) console.warn("EngineMonitor: backend returned malformed settings; using defaults");
        setSource("local");
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keep the first-paint cache in sync.
  useEffect(() => {
    try {
      safeStorage()?.setItem(THEME_STORAGE_KEY, settings.theme);
    } catch {
      // Cache only; the backend holds the real value.
    }
  }, [settings.theme]);

  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<AppError | null> => {
      const next: AppSettings = { ...settings, ...patch, visible: { ...settings.visible, ...patch.visible } };
      if (source === "local") {
        setSettings(next);
        return null;
      }
      const r = await setAppSettings(next);
      if (!r.ok) return r.error;
      setSettings(isAppSettings(r.value) ? r.value : next);
      return null;
    },
    [settings, source],
  );

  const value = useMemo(() => ({ settings, loaded, source, update }), [settings, loaded, source, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
