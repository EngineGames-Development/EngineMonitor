import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => core);

import { getAppInfo } from "./commands";
import { isAppError, toAppError } from "./errors";

describe("toAppError", () => {
  it("passes through backend errors", () => {
    const e = { kind: "permission_denied", message: "access denied" };
    expect(toAppError(e)).toEqual(e);
  });
  it("wraps strings and Error objects", () => {
    expect(toAppError("boom")).toEqual({ kind: "internal", message: "boom" });
    expect(toAppError(new Error("bad"))).toEqual({ kind: "internal", message: "bad" });
  });
  it("rejects unknown kinds", () => {
    expect(isAppError({ kind: "nope", message: "x" })).toBe(false);
  });
});

describe("getAppInfo", () => {
  beforeEach(() => {
    core.isTauri.mockReturnValue(true);
    core.invoke.mockReset();
  });

  it("invokes the app_info command", async () => {
    const info = {
      name: "EngineMonitor",
      version: "0.1.0",
      tauriVersion: "2.0.0",
      targetOs: "windows",
      targetArch: "x86_64",
      debugBuild: true,
    };
    core.invoke.mockResolvedValue(info);
    await expect(getAppInfo()).resolves.toEqual({ ok: true, value: info });
    expect(core.invoke).toHaveBeenCalledWith("app_info", undefined);
  });

  it("returns a typed error when the command fails", async () => {
    core.invoke.mockRejectedValue({ kind: "internal", message: "nope" });
    await expect(getAppInfo()).resolves.toEqual({ ok: false, error: { kind: "internal", message: "nope" } });
  });

  it("reports a missing backend instead of calling invoke", async () => {
    core.isTauri.mockReturnValue(false);
    const res = await getAppInfo();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("no_backend");
    expect(core.invoke).not.toHaveBeenCalled();
  });
});
