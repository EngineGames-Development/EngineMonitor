import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryPointDto, HistoryQuery, HistoryStatus } from "../../ipc/types";
import { formatBucket, mergeVolumes, withGaps } from "./historyData";
import { estimateSizeBytes } from "./HistorySettingsCard";

const tauri = vi.hoisted(() => ({
  updated: null as (() => void) | null,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: () => void) => {
    if (name === "history://updated") tauri.updated = cb;
    return () => {};
  },
}));

import { SettingsProvider } from "../../settings/SettingsProvider";
import { HistoryPage } from "./HistoryPage";

function point(t: number, cpu: number | null = 10): HistoryPointDto {
  return { t, cpu, cpuMax: cpu, memory: 50, swap: null, netRx: 1000, netTx: 100, diskRead: 0, diskWrite: 0, gpu: null };
}

function status(overrides: Partial<HistoryStatus["settings"]> = {}, rows = 3): HistoryStatus {
  return {
    settings: { enabled: true, intervalSecs: 5, retentionDays: 7, ...overrides },
    stats: { rows, oldestMs: 1_000, newestMs: 3_000, sizeBytes: 64 * 1024 },
    estimatedSizeBytes: 12_096_000,
    lastError: null,
    databasePath: "C:/data/history.sqlite3",
  };
}

function query(points: HistoryPointDto[]): HistoryQuery {
  return { fromMs: 0, toMs: 3_600_000, bucketMs: 10_000, points, volumes: [] };
}

describe("history data helpers", () => {
  it("inserts gaps where buckets are missing", () => {
    const out = withGaps([point(0), point(10_000), point(60_000)], 10_000, ["cpu"]);
    expect(out.map((p) => p.t)).toEqual([0, 10_000, 20_000, 60_000]);
    expect(out[2]!.cpu).toBeNull();
  });

  it("does not insert gaps for contiguous data", () => {
    expect(withGaps([point(0), point(10_000)], 10_000, ["cpu"])).toHaveLength(2);
  });

  it("merges per-volume series by timestamp", () => {
    const { data, series } = mergeVolumes(
      [
        { mountPoint: "C:\\", points: [{ t: 0, usedPercent: 50 }, { t: 60_000, usedPercent: 51 }] },
        { mountPoint: "D:\\", points: [{ t: 60_000, usedPercent: 10 }] },
      ],
      60_000,
    );
    expect(series).toEqual([{ key: "v0", mountPoint: "C:\\" }, { key: "v1", mountPoint: "D:\\" }]);
    expect(data).toEqual([
      { t: 0, v0: 50, v1: null },
      { t: 60_000, v0: 51, v1: 10 },
    ]);
  });

  it("formats bucket widths and estimates size like the backend", () => {
    expect(formatBucket(5_000)).toBe("5 s");
    expect(formatBucket(600_000)).toBe("10 min");
    expect(formatBucket(2 * 3_600_000)).toBe("2 h");
    expect(estimateSizeBytes({ enabled: true, intervalSecs: 5, retentionDays: 7 })).toBe(12_096_000);
  });
});

describe("History page", () => {
  beforeEach(() => {
    tauri.updated = null;
    tauri.invoke.mockReset().mockImplementation(async (cmd: string) => {
      if (cmd === "query_history") return query([point(0), point(10_000), point(20_000)]);
      if (cmd === "history_status") return status();
      if (cmd === "set_history_settings") return { enabled: true, intervalSecs: 5, retentionDays: 3 };
      if (cmd === "clear_history") return null;
      throw new Error(`unexpected ${cmd}`);
    });
  });

  it("queries the selected range and shows charts", async () => {
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    expect(await screen.findByRole("img", { name: "CPU and memory utilisation, last 1 hour" })).toBeInTheDocument();
    const call = tauri.invoke.mock.calls.find((c) => c[0] === "query_history")!;
    const args = call[1] as { fromMs: number; toMs: number; maxPoints: number };
    expect(args.toMs - args.fromMs).toBe(3_600_000);
    expect(args.maxPoints).toBe(480);
    // No GPU values recorded -> no GPU chart rather than an empty one.
    expect(screen.queryByRole("img", { name: /GPU utilisation/ })).not.toBeInTheDocument();
    expect(screen.getByText(/one point per 10 s/)).toBeInTheDocument();
  });

  it("re-queries when the range changes", async () => {
    const user = userEvent.setup();
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    await screen.findByRole("img", { name: "CPU and memory utilisation, last 1 hour" });
    await user.click(screen.getByRole("radio", { name: "7 days" }));
    await vi.waitFor(() => {
      const last = tauri.invoke.mock.calls.filter((c) => c[0] === "query_history").at(-1)![1] as { fromMs: number; toMs: number };
      expect(last.toMs - last.fromMs).toBe(7 * 86_400_000);
    });
  });

  it("reloads when the backend reports new history, without polling", async () => {
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    await screen.findByRole("img", { name: "CPU and memory utilisation, last 1 hour" });
    const before = tauri.invoke.mock.calls.filter((c) => c[0] === "query_history").length;
    await vi.waitFor(() => expect(tauri.updated).not.toBeNull());
    await act(async () => tauri.updated!());
    expect(tauri.invoke.mock.calls.filter((c) => c[0] === "query_history").length).toBe(before + 1);
  });

  it("explains an empty range", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) => (cmd === "query_history" ? query([]) : status({}, 0)));
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    expect(await screen.findByText("No history in this range yet")).toBeInTheDocument();
    expect(screen.getByText(/Recording is on: one point every 5 s/)).toBeInTheDocument();
  });

  it("saves settings and warns before shortening retention", async () => {
    const user = userEvent.setup();
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    await screen.findByRole("img", { name: "CPU and memory utilisation, last 1 hour" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Keep history for" }), "3");
    expect(screen.getByText("History older than 3 days will be deleted when you save.")).toBeInTheDocument();
    await user.click(save);
    expect(tauri.invoke).toHaveBeenCalledWith("set_history_settings", {
      settings: { enabled: true, intervalSecs: 5, retentionDays: 3 },
    });
  });

  it("clears history only after confirmation", async () => {
    const user = userEvent.setup();
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    await screen.findByRole("img", { name: "CPU and memory utilisation, last 1 hour" });
    await user.click(screen.getByRole("button", { name: "Clear history…" }));
    const dialog = screen.getByRole("dialog", { name: "Clear all history?" });
    expect(tauri.invoke).not.toHaveBeenCalledWith("clear_history", undefined);
    await user.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(tauri.invoke).toHaveBeenCalledWith("clear_history", undefined);
  });

  it("shows the backend error when history is unavailable", async () => {
    tauri.invoke.mockImplementation(async () => {
      throw { kind: "internal", message: "could not open the history database: file is not a database" };
    });
    render(<SettingsProvider><HistoryPage /></SettingsProvider>);
    expect(await screen.findByText("History unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("file is not a database");
  });
});
