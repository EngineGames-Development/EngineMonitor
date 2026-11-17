export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];

/**
 * localStorage key caching the theme for the first paint only. The persisted
 * value lives in the backend settings (SQLite); see SettingsProvider.
 */
export const THEME_STORAGE_KEY = "enginemonitor.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

export function readStoredPreference(storage: Pick<Storage, "getItem"> | undefined): ThemePreference {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : "dark"; // dark-first default
  } catch {
    // Storage can throw when disabled; fall back to the default.
    return "dark";
  }
}
