import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { isThemePreference, readStoredPreference, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme helpers", () => {
  it("resolves system preference using the OS setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("validates stored values", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("purple")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });

  it("defaults to dark for missing, invalid or throwing storage", () => {
    expect(readStoredPreference(undefined)).toBe("dark");
    expect(readStoredPreference({ getItem: () => "neon" })).toBe("dark");
    expect(
      readStoredPreference({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe("dark");
    expect(readStoredPreference({ getItem: () => "light" })).toBe("light");
  });
});

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="pref">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference("light")}>light</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("applies the theme to <html> and persists changes", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => screen.getByText("light").click());

    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores a persisted preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("light");
  });
});
