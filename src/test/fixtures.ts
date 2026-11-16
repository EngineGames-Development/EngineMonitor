/**
 * Test-only builders for backend payloads. Never imported by app code.
 */
import type { Snapshot, SnapshotEvent, SystemInfo, VolumeSample } from "../ipc/types";

const GIB = 1024 ** 3;

export function makeSystemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    osName: "Windows",
    osVersion: "11 (26300)",
    osLongName: "Windows 11 Home",
    kernelVersion: "26300",
    bootTimeSecs: 1_700_000_000,
    cpu: { brand: "Test CPU 4-Core", vendor: "TestVendor", architecture: "x86_64", logicalCores: 4, physicalCores: 4 },
    totalMemoryBytes: 16 * GIB,
    ...overrides,
  };
}

export function makeVolume(overrides: Partial<VolumeSample> = {}): VolumeSample {
  return {
    id: "C:\\",
    name: "System",
    mountPoint: "C:\\",
    fileSystem: "NTFS",
    kind: "ssd",
    removable: false,
    readOnly: false,
    totalBytes: 500 * GIB,
    availableBytes: 100 * GIB,
    usedBytes: 400 * GIB,
    usagePercent: 80,
    io: { status: "ok", value: { readBytesPerSec: 1024, writeBytesPerSec: 2048, totalReadBytes: 1, totalWrittenBytes: 1 } },
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    timestampMs: 1_800_000_000_000,
    uptimeSecs: 3_725,
    cpu: {
      usagePercent: 37.5,
      cores: [0, 1, 2, 3].map(() => ({ usagePercent: 37.5, frequencyMhz: 3600 })),
      frequencyMhz: 3600,
      loadAverage: { status: "unsupported", reason: "load average is not available on windows" },
    },
    memory: {
      totalBytes: 16 * GIB,
      usedBytes: 4 * GIB,
      availableBytes: 12 * GIB,
      usagePercent: 25,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsagePercent: null,
    },
    storage: [makeVolume()],
    network: {
      receiveBytesPerSec: 125_000,
      transmitBytesPerSec: 12_500,
      interfaces: [],
    },
    ...overrides,
  };
}

export function makeEvent(sequence: number, snapshot: Partial<Snapshot> = {}): SnapshotEvent {
  return {
    sequence,
    intervalMs: 1000,
    snapshot: makeSnapshot({ timestampMs: 1_800_000_000_000 + sequence * 1000, ...snapshot }),
  };
}
