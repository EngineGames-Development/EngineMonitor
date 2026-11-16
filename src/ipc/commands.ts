import { invoke, isTauri } from "@tauri-apps/api/core";
import { toAppError, type AppError } from "./errors";
import type { SnapshotEvent, SystemInfo } from "./types";

/** Mirror of `commands::AppInfo` in Rust. */
export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  targetOs: string;
  targetArch: string;
  debugBuild: boolean;
}

export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

const NO_BACKEND: AppError = {
  kind: "no_backend",
  message: "The EngineMonitor backend is not available. Start the app with `npm run tauri dev`.",
};

/** Calls a backend command and never throws; failures come back as `AppError`. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<CommandResult<T>> {
  if (!isTauri()) return { ok: false, error: NO_BACKEND };
  try {
    return { ok: true, value: await invoke<T>(command, args) };
  } catch (err) {
    return { ok: false, error: toAppError(err) };
  }
}

export function getAppInfo(): Promise<CommandResult<AppInfo>> {
  return call<AppInfo>("app_info");
}

export function getSystemInfo(): Promise<CommandResult<SystemInfo>> {
  return call<SystemInfo>("system_info");
}

/** Includes the process list in snapshot events while enabled (Processes page). */
export function setProcessMonitoring(enabled: boolean): Promise<CommandResult<null>> {
  return call<null>("set_process_monitoring", { enabled });
}

/**
 * Ends a process. `startTimeSecs` must be the start time shown in the
 * confirmation; the backend refuses if the PID now belongs to another process.
 */
export function terminateProcess(pid: number, startTimeSecs: number): Promise<CommandResult<null>> {
  return call<null>("terminate_process", { pid, startTimeSecs });
}

/** Latest sample, or null before the first tick. One-shot: live data arrives as events. */
export function getLatestSnapshot(): Promise<CommandResult<SnapshotEvent | null>> {
  return call<SnapshotEvent | null>("latest_snapshot");
}
