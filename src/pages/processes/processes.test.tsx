import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessSample, SnapshotEvent } from "../../ipc/types";
import { makeEvent, makeProcess, makeSystemInfo } from "../../test/fixtures";

const tauri = vi.hoisted(() => ({
  handler: null as ((e: { payload: unknown }) => void) | null,
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { TestProviders } from "../../test/providers";
import { ProcessesPage } from "./ProcessesPage";

const OWN_PID = 999;
const editor = makeProcess({ pid: 1234, name: "editor.exe", cpuPercent: 3.5, startTimeSecs: 1_799_990_000 });
const browser = makeProcess({ pid: 2000, name: "browser.exe", cpuPercent: 40, exe: null });
const self = makeProcess({
  pid: OWN_PID,
  name: "enginemonitor.exe",
  cpuPercent: 0.5,
  exe: String.raw`C:\Program Files\EngineMonitor\enginemonitor.exe`,
});

function eventWith(processes: ProcessSample[], seq = 1): SnapshotEvent {
  return { ...makeEvent(seq), processes: { processes, ownPid: OWN_PID } };
}

async function renderWithProcesses(processes = [editor, browser, self]) {
  const utils = render(
    <TestProviders>
      <ProcessesPage />
    </TestProviders>,
  );
  await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
  act(() => tauri.handler!({ payload: eventWith(processes) }));
  return utils;
}

function rows() {
  return screen.getAllByRole("row").slice(1); // skip header
}

beforeEach(() => {
  tauri.handler = null;
  tauri.listen.mockReset().mockImplementation(async (_n: string, cb: (e: { payload: unknown }) => void) => {
    tauri.handler = cb;
    return () => {};
  });
  tauri.invoke.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === "system_info") return makeSystemInfo();
    if (cmd === "latest_snapshot") return null;
    if (cmd === "set_process_monitoring") return null;
    if (cmd === "terminate_process") return null;
    throw new Error(`unexpected ${cmd}`);
  });
});

describe("Processes page", () => {
  it("enables the process stream while mounted and disables it on unmount", async () => {
    const { unmount } = await renderWithProcesses();
    expect(tauri.invoke).toHaveBeenCalledWith("set_process_monitoring", { enabled: true });
    unmount();
    expect(tauri.invoke).toHaveBeenCalledWith("set_process_monitoring", { enabled: false });
  });

  it("shows a loading state until a process list arrives", async () => {
    render(
      <TestProviders>
        <ProcessesPage />
      </TestProviders>,
    );
    await vi.waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("latest_snapshot", undefined));
    act(() => tauri.handler!({ payload: makeEvent(1) })); // no processes yet
    expect(screen.getByLabelText("Collecting process list")).toBeInTheDocument();
  });

  it("lists processes sorted by CPU and marks EngineMonitor itself", async () => {
    await renderWithProcesses();
    const names = rows().map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toBe("browser.exe");
    expect(names[1]).toBe("editor.exe");
    expect(names[2]).toContain("enginemonitor.exe");
    expect(names[2]).toContain("This app");
  });

  it("searches and re-sorts", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.type(screen.getByRole("searchbox", { name: "Search processes" }), "edit");
    expect(rows()).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Search processes" }));

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    expect(within(rows()[0]!).getAllByRole("cell")[0]).toHaveTextContent("browser.exe");
  });

  it("shows details including an inaccessible path", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("browser.exe"));
    expect(screen.getByText("Not available — protected or owned by another user")).toBeInTheDocument();
  });

  it("ends a process only after confirmation, sending PID and start time", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("editor.exe"));
    await user.click(screen.getByRole("button", { name: "End process" }));

    const dialog = screen.getByRole("dialog", { name: "End editor.exe?" });
    expect(tauri.invoke).not.toHaveBeenCalledWith("terminate_process", expect.anything());
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "End process" }));
    expect(tauri.invoke).toHaveBeenCalledWith("terminate_process", { pid: 1234, startTimeSecs: 1_799_990_000 });
    expect(await screen.findByRole("status")).toHaveTextContent("Ended editor.exe (PID 1234).");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancel and Escape close the dialog without ending anything", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("editor.exe"));
    await user.click(screen.getByRole("button", { name: "End process" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tauri.invoke).not.toHaveBeenCalledWith("terminate_process", expect.anything());
  });

  it("shows the OS refusal inside the dialog", async () => {
    tauri.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "system_info") return makeSystemInfo();
      if (cmd === "terminate_process") throw { kind: "permission_denied", message: "access denied while trying to terminate" };
      return null;
    });
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("editor.exe"));
    await user.click(screen.getByRole("button", { name: "End process" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "End process" }));
    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("Access denied");
    expect(alert).toHaveTextContent("access denied while trying to terminate");
  });

  it("does not allow ending EngineMonitor itself", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("enginemonitor.exe"));
    expect(screen.getByRole("button", { name: "End process" })).toBeDisabled();
  });

  it("says so when the selected process exits", async () => {
    const user = userEvent.setup();
    await renderWithProcesses();
    await user.click(screen.getByText("editor.exe"));
    act(() => tauri.handler!({ payload: eventWith([browser, self], 2) }));
    expect(screen.getByText("This process has exited.")).toBeInTheDocument();
  });
});
