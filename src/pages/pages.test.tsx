import { act, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../ipc/types";
import { makeEvent, makeGpu, makeSnapshot, makeSystemInfo } from "../test/fixtures";

const tauri = vi.hoisted(() => ({
  handler: null as ((e: { payload: unknown }) => void) | null,
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_n: string, cb: (e: { payload: unknown }) => void) => {
    tauri.handler = cb;
    return () => {};
  },
}));

import { MetricsProvider } from "../metrics/MetricsProvider";
import { CpuPage } from "./cpu/CpuPage";
import { GpuPage } from "./gpu/GpuPage";
import { MemoryPage } from "./memory/MemoryPage";
import { NetworkPage } from "./network/NetworkPage";
import { StoragePage } from "./storage/StoragePage";

beforeEach(() => {
  tauri.handler = null;
  tauri.invoke.mockReset().mockImplementation(async (cmd: string) => (cmd === "system_info" ? makeSystemInfo() : null));
});

async function show(page: ReactElement, snapshot: Partial<Snapshot> = {}) {
  render(<MetricsProvider>{page}</MetricsProvider>);
  await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
  act(() => tauri.handler!({ payload: makeEvent(1, snapshot) }));
}

describe("CPU page", () => {
  it("labels frequency as reported and shows unsupported load average", async () => {
    await show(<CpuPage />);
    expect(screen.getByText("Reported frequency")).toBeInTheDocument();
    // Summary plus one entry per core.
    expect(screen.getAllByText("3.60 GHz")).toHaveLength(5);
    expect(screen.getByText("Unsupported")).toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(4); // one per core
  });

  it("shows load average where the OS provides it", async () => {
    const cpu = { ...makeSnapshot().cpu, loadAverage: { status: "ok" as const, value: { one: 1.5, five: 1, fifteen: 0.5 } } };
    await show(<CpuPage />, { cpu });
    expect(screen.getByText("1.50 · 1.00 · 0.50")).toBeInTheDocument();
  });
});

describe("Memory page", () => {
  it("states that no swap is configured instead of showing 0 %", async () => {
    await show(<MemoryPage />);
    expect(screen.getByText("No swap space or page file is configured.")).toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: "Swap used" })).not.toBeInTheDocument();
  });
});

describe("GPU page", () => {
  it("shows adapter data and marks temperature unsupported", async () => {
    await show(<GpuPage />);
    const card = screen.getByRole("heading", { name: "Test GPU" }).closest("section")!;
    expect(within(card).getByText("12 %")).toBeInTheDocument();
    expect(within(card).getByText("1.00 GiB / 2.00 GiB")).toBeInTheDocument();
    expect(within(card).getByText("Unsupported")).toBeInTheDocument();
  });

  it("explains when GPU monitoring is unsupported or failed", async () => {
    await show(<GpuPage />, { gpu: { status: "unsupported", reason: "GPU information is not available on testos" } });
    expect(screen.getByText("GPU information is not available on testos")).toBeInTheDocument();
  });

  it("shows pending usage while the first delta is measured", async () => {
    await show(<GpuPage />, { gpu: { status: "ok", value: [makeGpu({ usagePercent: { status: "pending" } })] } });
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});

describe("Storage and Network pages", () => {
  it("lists volumes on the Storage page", async () => {
    await show(<StoragePage />);
    expect(screen.getByText("System (C:\\)")).toBeInTheDocument();
  });

  it("lists interfaces with rates on the Network page", async () => {
    await show(<NetworkPage />, {
      network: {
        receiveBytesPerSec: 125_000,
        transmitBytesPerSec: 0,
        interfaces: [
          {
            name: "Ethernet",
            state: "up",
            loopback: false,
            macAddress: "00:1a:2b:3c:4d:5e",
            addresses: ["192.168.1.20/24"],
            mtu: 1500,
            linkSpeedBps: 1_000_000_000,
            totalReceivedBytes: 1024,
            totalTransmittedBytes: 2048,
            receiveBytesPerSec: 125_000,
            transmitBytesPerSec: null,
          },
        ],
      },
    });
    const row = screen.getByText("Ethernet").closest("tr")!;
    expect(within(row).getByText("192.168.1.20/24")).toBeInTheDocument();
    expect(within(row).getByText("1 Gbit/s")).toBeInTheDocument();
    expect(within(row).getByText("1.00 Mbit/s")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument(); // upload not measured yet
  });
});
