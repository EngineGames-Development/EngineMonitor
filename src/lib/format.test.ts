import { describe, expect, it } from "vitest";
import {
  formatBitRate,
  formatByteRate,
  formatBytes,
  formatDuration,
  formatFrequencyMHz,
  formatPercent,
  splitBytes,
  UNAVAILABLE,
} from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.00 KiB"],
    [1536, "1.50 KiB"],
    [10 * 1024 * 1024, "10.0 MiB"],
    [512 * 1024 ** 3, "512 GiB"],
    [16 * 1024 ** 3, "16.0 GiB"],
    [2 * 1024 ** 4, "2.00 TiB"],
  ])("%d bytes -> %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("caps at the largest unit", () => {
    expect(splitBytes(1024 ** 7).unit).toBe("PiB");
  });

  it.each([NaN, Infinity, -1])("returns the unavailable marker for %s", (bad) => {
    expect(formatBytes(bad)).toBe(UNAVAILABLE);
  });
});

describe("rates", () => {
  it("formats byte rates with /s", () => {
    expect(formatByteRate(2.5 * 1024 * 1024)).toBe("2.50 MiB/s");
  });

  it("formats bit rates with decimal multiples", () => {
    expect(formatBitRate(125)).toBe("1.00 kbit/s"); // 1000 bit/s
    expect(formatBitRate(12_500_000)).toBe("100 Mbit/s");
    expect(formatBitRate(0)).toBe("0 bit/s");
  });

  it("refuses negative rates rather than showing them", () => {
    expect(formatByteRate(-5)).toBe(UNAVAILABLE);
    expect(formatBitRate(-5)).toBe(UNAVAILABLE);
  });
});

describe("formatPercent", () => {
  it("uses one decimal below 10 and none above", () => {
    expect(formatPercent(4.236)).toBe("4.2");
    expect(formatPercent(37.6)).toBe("38");
    expect(formatPercent(100)).toBe("100");
  });
  it("clamps tiny negative noise to zero", () => {
    expect(formatPercent(-0.01)).toBe("0.0");
  });
  it("handles NaN", () => {
    expect(formatPercent(NaN)).toBe(UNAVAILABLE);
  });
});

describe("formatFrequencyMHz", () => {
  it("switches to GHz above 1000 MHz", () => {
    expect(formatFrequencyMHz(3600)).toBe("3.60 GHz");
    expect(formatFrequencyMHz(800)).toBe("800 MHz");
  });
  it("treats 0 as unavailable (sysinfo reports 0 when unknown)", () => {
    expect(formatFrequencyMHz(0)).toBe(UNAVAILABLE);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [723, "12m 03s"],
    [5 * 3600 + 7 * 60, "5h 07m"],
    [3 * 86400 + 4 * 3600 + 12 * 60 + 59, "3d 4h 12m"],
  ])("%d s -> %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
  it("rejects negative input", () => {
    expect(formatDuration(-1)).toBe(UNAVAILABLE);
  });
});
