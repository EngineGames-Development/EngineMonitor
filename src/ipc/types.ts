/**
 * Hand-written mirrors of the Rust types serialised to the frontend.
 * Source of truth: src-tauri/src/{reading,system,cpu,memory,storage,network,events}.
 * Keep field names and nullability in sync when changing either side.
 */

/** `reading::Reading<T>`. */
export type Reading<T> =
  | { status: "ok"; value: T }
  | { status: "unsupported"; reason: string }
  | { status: "error"; message: string }
  /** Derived from two samples; not available yet. */
  | { status: "pending" };

/** The value of an ok reading, else null. */
export function readingValue<T>(r: Reading<T>): T | null {
  return r.status === "ok" ? r.value : null;
}

export interface CpuInfo {
  brand: string | null;
  vendor: string | null;
  architecture: string;
  logicalCores: number;
  physicalCores: number | null;
}

export interface SystemInfo {
  osName: string | null;
  osVersion: string | null;
  osLongName: string | null;
  kernelVersion: string | null;
  bootTimeSecs: number | null;
  cpu: CpuInfo;
  totalMemoryBytes: number;
}

export interface CoreSample {
  /** null on the first (unprimed) tick. */
  usagePercent: number | null;
  frequencyMhz: number | null;
}

export interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

export interface CpuSample {
  usagePercent: number | null;
  cores: CoreSample[];
  frequencyMhz: number | null;
  loadAverage: Reading<LoadAverage>;
}

export interface MemorySample {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number | null;
  swapTotalBytes: number;
  swapUsedBytes: number;
  /** null when no swap is configured. */
  swapUsagePercent: number | null;
}

export type MediaKind = "ssd" | "hdd" | "unknown";

export interface DiskIo {
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  totalReadBytes: number;
  totalWrittenBytes: number;
}

export interface VolumeSample {
  id: string;
  name: string;
  mountPoint: string;
  fileSystem: string;
  kind: MediaKind;
  removable: boolean;
  readOnly: boolean;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number | null;
  io: Reading<DiskIo>;
}

export type LinkState = "up" | "down" | "unknown";

export interface InterfaceSample {
  name: string;
  state: LinkState;
  loopback: boolean;
  macAddress: string | null;
  addresses: string[];
  mtu: number | null;
  linkSpeedBps: number | null;
  totalReceivedBytes: number;
  totalTransmittedBytes: number;
  receiveBytesPerSec: number | null;
  transmitBytesPerSec: number | null;
}

export interface NetworkSample {
  receiveBytesPerSec: number | null;
  transmitBytesPerSec: number | null;
  interfaces: InterfaceSample[];
}

/** `gpu::GpuSample`. Dedicated VRAM only. */
export interface GpuSample {
  id: string;
  model: string | null;
  vendor: string | null;
  provider: string;
  usagePercent: Reading<number>;
  memoryTotalBytes: Reading<number>;
  memoryUsedBytes: Reading<number>;
  memoryUsagePercent: number | null;
  temperatureCelsius: Reading<number>;
}

export interface Snapshot {
  timestampMs: number;
  uptimeSecs: number | null;
  cpu: CpuSample;
  memory: MemorySample;
  storage: VolumeSample[];
  network: NetworkSample;
  gpu: Reading<GpuSample[]>;
}

/** `processes::ProcessSample`. */
export interface ProcessSample {
  pid: number;
  parentPid: number | null;
  name: string;
  /** null when the OS does not reveal it (protected / other user). */
  exe: string | null;
  status: string;
  /** Share of total machine CPU, 0-100; null on a process's first tick. */
  cpuPercent: number | null;
  memoryBytes: number;
  virtualMemoryBytes: number;
  diskReadBytesPerSec: number | null;
  diskWriteBytesPerSec: number | null;
  startTimeSecs: number;
  runTimeSecs: number;
}

export interface ProcessList {
  processes: ProcessSample[];
  ownPid: number;
}

/** `events::SnapshotEvent`, payload of the `metrics://snapshot` event. */
export interface SnapshotEvent {
  sequence: number;
  intervalMs: number;
  snapshot: Snapshot;
  /** Present only while process monitoring is enabled. */
  processes: ProcessList | null;
}

export const SNAPSHOT_EVENT = "metrics://snapshot";
