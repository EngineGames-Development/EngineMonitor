import { invoke, isTauri } from "@tauri-apps/api/core";
import { toAppError, type AppError } from "./errors";

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
