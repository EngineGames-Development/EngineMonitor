import { describe, expect, it } from "vitest";
import { computeWindow } from "../../design/useVirtualRows";
import { makeProcess } from "../../test/fixtures";
import { defaultDir, diskRate, matchesFilter, matchesQuery, sortProcesses, visibleProcesses } from "./processTable";

const a = makeProcess({ pid: 10, name: "alpha.exe", cpuPercent: 5, memoryBytes: 300, exe: String.raw`C:\Apps\alpha.exe` });
const b = makeProcess({ pid: 20, name: "Beta.exe", cpuPercent: null, memoryBytes: 100, exe: null });
const c = makeProcess({ pid: 30, name: "gamma.exe", cpuPercent: 0.01, memoryBytes: 200, diskReadBytesPerSec: null, diskWriteBytesPerSec: null });

describe("process filtering", () => {
  it("matches name and path case-insensitively, and exact PID", () => {
    expect(matchesQuery(b, "beta")).toBe(true);
    expect(matchesQuery(a, String.raw`apps\alpha`)).toBe(true);
    expect(matchesQuery(a, "10")).toBe(true);
    expect(matchesQuery(a, "1")).toBe(false); // PID must match exactly
    expect(matchesQuery(a, "   ")).toBe(true);
  });

  it("filters active and accessible processes", () => {
    expect(matchesFilter(a, "active")).toBe(true);
    expect(matchesFilter(b, "active")).toBe(false); // unmeasured is not active
    expect(matchesFilter(c, "active")).toBe(false); // below noise threshold
    expect(matchesFilter(b, "accessible")).toBe(false);
    expect(matchesFilter(b, "all")).toBe(true);
  });

  it("disk rate is null only when both directions are unknown", () => {
    expect(diskRate(c)).toBeNull();
    expect(diskRate(makeProcess({ diskReadBytesPerSec: null, diskWriteBytesPerSec: 5 }))).toBe(5);
  });
});

describe("process sorting", () => {
  it("sorts numbers and keeps unknown values last in both directions", () => {
    expect(sortProcesses([a, b, c], "cpu", "desc").map((p) => p.pid)).toEqual([10, 30, 20]);
    expect(sortProcesses([a, b, c], "cpu", "asc").map((p) => p.pid)).toEqual([30, 10, 20]);
  });

  it("sorts names case-insensitively and breaks ties by PID", () => {
    expect(sortProcesses([c, b, a], "name", "asc").map((p) => p.name)).toEqual(["alpha.exe", "Beta.exe", "gamma.exe"]);
    const x = makeProcess({ pid: 2, memoryBytes: 1 });
    const y = makeProcess({ pid: 1, memoryBytes: 1 });
    expect(sortProcesses([x, y], "memory", "desc").map((p) => p.pid)).toEqual([1, 2]);
  });

  it("does not mutate the input and combines filter + sort", () => {
    const input = [a, b, c];
    visibleProcesses(input, "a", "all", "memory", "desc");
    expect(input.map((p) => p.pid)).toEqual([10, 20, 30]);
    expect(visibleProcesses(input, "", "accessible", "memory", "asc").map((p) => p.pid)).toEqual([30, 10]);
  });

  it("chooses sensible default directions", () => {
    expect(defaultDir("cpu")).toBe("desc");
    expect(defaultDir("name")).toBe("asc");
  });
});

describe("computeWindow", () => {
  it("renders only visible rows plus overscan", () => {
    const w = computeWindow(1000, 30, 3000, 300, 5);
    expect(w.start).toBe(95);
    expect(w.end).toBe(115);
    expect(w.offsetTop).toBe(95 * 30);
    expect(w.totalHeight).toBe(30_000);
  });

  it("clamps at the edges and handles unmeasured containers", () => {
    expect(computeWindow(10, 30, 0, 0, 5)).toEqual({ start: 0, end: 10, offsetTop: 0, totalHeight: 300 });
    const end = computeWindow(100, 30, 2_900, 300, 2);
    expect(end.end).toBe(100);
    expect(computeWindow(0, 30, 0, 300, 5)).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
  });
});
