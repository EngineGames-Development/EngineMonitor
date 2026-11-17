import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_SETTINGS, isAppSettings, type AppSettings } from "../ipc/types";
import { makeEvent, makeSystemInfo } from "../test/fixtures";

const tauri = vi.hoisted(() => ({
  handler: null as ((e: { payload: unknown }) => void) | null,
  invoke: vi.fn(),
  saved: null as AppSettings | null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    if (name === "metrics://snapshot") tauri.handler = cb;
    return () => {};
  },
}));

import { SettingsPage } from "../pages/SettingsPage";
import { OverviewPage } from "../pages/overview/OverviewPage";
import { TestProviders } from "../test/providers";

function backend(initial: AppSettings = DEFAULT_APP_SETTINGS) {
  tauri.saved = initial;
  tauri.invoke.mockReset().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "app_settings":
        return tauri.saved;
      case "set_app_settings":
        tauri.saved = args!.settings as AppSettings;
        return tauri.saved;
      case "launch_at_login":
        return false;
      case "set_launch_at_login":
        return args!.enabled;
      case "history_status":
        return {
          settings: { enabled: true, intervalSecs: 5, retentionDays: 7 },
          stats: { rows: 0, oldestMs: null, newestMs: null, sizeBytes: 4096 },
          estimatedSizeBytes: 1,
          lastError: null,
          databasePath: "x",
        };
      case "app_info":
        return { name: "EngineMonitor", version: "0.1.0", tauriVersion: "2", targetOs: "windows", targetArch: "x86_64", debugBuild: false };
      case "system_info":
        return makeSystemInfo();
      case "latest_snapshot":
        return null;
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  });
}

beforeEach(() => {
  tauri.handler = null;
  backend();
});

describe("isAppSettings", () => {
  it("accepts the defaults and rejects malformed payloads", () => {
    expect(isAppSettings(DEFAULT_APP_SETTINGS)).toBe(true);
    expect(isAppSettings(null)).toBe(false);
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, theme: "neon" })).toBe(false);
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, visible: { gpu: true } })).toBe(false);
  });
});

describe("Settings page", () => {
  it("shows values loaded from the backend", async () => {
    backend({ ...DEFAULT_APP_SETTINGS, refreshIntervalMs: 2000, networkUnit: "bytes" });
    render(<TestProviders><SettingsPage /></TestProviders>);
    expect(await screen.findByDisplayValue("2 s")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bytes (MiB/s)" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves a change immediately with the complete settings object", async () => {
    const user = userEvent.setup();
    render(<TestProviders><SettingsPage /></TestProviders>);
    await screen.findByDisplayValue("1 s");
    await user.selectOptions(screen.getByLabelText("Refresh interval"), "500");
    expect(tauri.invoke).toHaveBeenCalledWith("set_app_settings", {
      settings: { ...DEFAULT_APP_SETTINGS, refreshIntervalMs: 500 },
    });
    await user.click(screen.getByRole("switch", { name: "Show GPU on the Overview" }));
    expect(tauri.saved!.visible.gpu).toBe(false);
    expect(tauri.saved!.refreshIntervalMs).toBe(500); // earlier change kept
  });

  it("shows the backend's reason when saving fails and keeps the old value", async () => {
    const user = userEvent.setup();
    render(<TestProviders><SettingsPage /></TestProviders>);
    await screen.findByDisplayValue("1 s");
    tauri.invoke.mockImplementationOnce(async () => {
      throw { kind: "unsupported", message: "settings cannot be saved because storage is unavailable" };
    });
    await user.selectOptions(screen.getByLabelText("Refresh interval"), "5000");
    expect(await screen.findByRole("alert")).toHaveTextContent("storage is unavailable");
    expect(screen.getByLabelText("Refresh interval")).toHaveValue("1000");
  });

  it("reads and toggles launch at login through the backend", async () => {
    const user = userEvent.setup();
    render(<TestProviders><SettingsPage /></TestProviders>);
    const sw = await screen.findByRole("switch", { name: "Launch at login" });
    await vi.waitFor(() => expect(sw).not.toBeDisabled());
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(tauri.invoke).toHaveBeenCalledWith("set_launch_at_login", { enabled: true });
    await vi.waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
  });

  it("says settings are not saved when the backend returns malformed data", async () => {
    tauri.saved = { nonsense: true } as unknown as AppSettings;
    render(<TestProviders><SettingsPage /></TestProviders>);
    expect(await screen.findByText("Not saved: backend unavailable")).toBeInTheDocument();
  });
});

describe("Settings applied to the Overview", () => {
  async function overview(settings: AppSettings) {
    backend(settings);
    render(<TestProviders><OverviewPage /></TestProviders>);
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());
    act(() => tauri.handler!({ payload: makeEvent(1) }));
  }

  it("hides sections the user turned off", async () => {
    await overview({ ...DEFAULT_APP_SETTINGS, visible: { gpu: false, disk: false, network: true, storage: false } });
    await vi.waitFor(() => expect(screen.queryByText("Test GPU")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Disk activity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Storage devices")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Network" })).toBeInTheDocument();
  });

  it("formats network rates in bytes when chosen", async () => {
    await overview({ ...DEFAULT_APP_SETTINGS, networkUnit: "bytes" });
    const net = await screen.findByRole("region", { name: "Network" });
    // 125 000 B/s = 122 KiB/s
    await vi.waitFor(() => expect(within(net).getByText("KiB/s")).toBeInTheDocument());
    expect(within(net).getByText("122")).toBeInTheDocument();
  });
});
