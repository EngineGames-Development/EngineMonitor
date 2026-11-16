import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotEvent } from "../../ipc/types";
import { makeEvent, makeSnapshot, makeSystemInfo, makeVolume } from "../../test/fixtures";

// --- Tauri mocks -----------------------------------------------------------
const tauri = vi.hoisted(() => ({
  handler: null as ((e: { payload: unknown }) => void) | null,
  unlisten: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { MetricsProvider } from "../../metrics/MetricsProvider";
import { OverviewPage } from "./OverviewPage";

function emit(event: SnapshotEvent) {
  act(() => tauri.handler!({ payload: event }));
}

function renderOverview() {
  return render(
    <MetricsProvider>
      <OverviewPage />
    </MetricsProvider>,
  );
}

beforeEach(() => {
  tauri.handler = null;
  tauri.unlisten.mockReset();
  tauri.listen.mockReset().mockImplementation(async (_name: string, cb: (e: { payload: unknown }) => void) => {
    tauri.handler = cb;
    return tauri.unlisten;
  });
  tauri.invoke.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === "system_info") return makeSystemInfo();
    if (cmd === "latest_snapshot") return null;
    throw new Error(`unexpected command ${cmd}`);
  });
});

describe("Overview (live data)", () => {
  it("subscribes once to the snapshot event and shows a loading state until data arrives", async () => {
    renderOverview();
    expect(await screen.findByLabelText("Waiting for the first measurement")).toBeInTheDocument();
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    expect(tauri.listen).toHaveBeenCalledWith("metrics://snapshot", expect.any(Function));
  });

  it("renders values from the received snapshot", async () => {
    renderOverview();
    await vi.waitFor(() => expect(tauri.handler).not.toBeNull());
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    emit(makeEvent(1));

    const cpu = screen.getByRole("region", { name: "CPU" });
    expect(within(cpu).getByText("38")).toBeInTheDocument(); // 37.5 % -> "38"
    const mem = screen.getByRole("region", { name: "Memory" });
    expect(within(mem).getByText("25")).toBeInTheDocument();
    expect(within(mem).getByText("4.00 GiB of 16.0 GiB")).toBeInTheDocument();
    // 125 000 B/s = 1.00 Mbit/s
    const net = screen.getByRole("region", { name: "Network" });
    expect(within(net).getByText("1.00")).toBeInTheDocument();
    expect(within(net).getByText("Mbit/s")).toBeInTheDocument();

    expect(screen.getByText("Windows 11 Home")).toBeInTheDocument();
    expect(screen.getByText("Test CPU 4-Core")).toBeInTheDocument();
    expect(screen.getByText("1h 02m")).toBeInTheDocument(); // uptime 3725 s
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("hydrates from latest_snapshot without waiting for the next event", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) =>
      cmd === "system_info" ? makeSystemInfo() : makeEvent(7),
    );
    renderOverview();
    expect(await screen.findByRole("region", { name: "CPU" })).toBeInTheDocument();
  });

  it("updates when new events arrive", async () => {
    renderOverview();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    emit(makeEvent(1));
    emit(makeEvent(2, { cpu: { ...makeSnapshot().cpu, usagePercent: 91 } }));
    const cpu = screen.getByRole("region", { name: "CPU" });
    expect(within(cpu).getByText("91")).toBeInTheDocument();
  });

  it("shows 'measuring' instead of 0 on the first, unprimed tick", async () => {
    renderOverview();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    emit(
      makeEvent(0, {
        cpu: { ...makeSnapshot().cpu, usagePercent: null },
        network: { receiveBytesPerSec: null, transmitBytesPerSec: null, interfaces: [] },
      }),
    );
    const cpu = screen.getByRole("region", { name: "CPU" });
    expect(within(cpu).getByText("—")).toBeInTheDocument();
    expect(within(cpu).getByText("Measuring — needs two samples")).toBeInTheDocument();
    expect(within(cpu).queryByText("0")).not.toBeInTheDocument();
  });

  it("marks volumes without I/O counters as unsupported and GPU as not implemented", async () => {
    renderOverview();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    emit(
      makeEvent(1, {
        storage: [makeVolume({ id: "G:\\", mountPoint: "G:\\", name: "Drive", io: { status: "unsupported", reason: "no counters" } })],
      }),
    );
    expect(screen.getByText("Drive (G:\\)")).toBeInTheDocument();
    expect(screen.getByText("Unsupported")).toBeInTheDocument();
    expect(screen.getByText("No volume reports I/O counters")).toBeInTheDocument();
    expect(screen.getByText("Not implemented")).toBeInTheDocument();
  });

  it("shows the backend error when collectors failed to start", async () => {
    tauri.invoke.mockImplementation(async () => {
      throw { kind: "unsupported", message: "system information is not supported on this platform" };
    });
    renderOverview();
    expect(await screen.findByText("Monitoring unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("system information is not supported on this platform");
  });

  it("unsubscribes on unmount after registration completed", async () => {
    const { unmount } = renderOverview();
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    unmount();
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes even when unmounted while the listener is still registering", async () => {
    let resolveListen: (fn: () => void) => void = () => {};
    tauri.listen.mockImplementation(
      () => new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      }),
    );
    const { unmount } = renderOverview();
    unmount();
    expect(tauri.unlisten).not.toHaveBeenCalled();
    resolveListen(tauri.unlisten);
    await vi.waitFor(() => expect(tauri.unlisten).toHaveBeenCalledTimes(1));
  });
});
