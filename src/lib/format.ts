/**
 * Unit formatting helpers.
 *
 * Byte quantities use binary (IEC) multiples — KiB, MiB, GiB — because that is
 * what the OS reports for memory and what file systems allocate in. Network
 * rates can be shown in bytes/s or bits/s; bit rates use decimal multiples
 * (kbit/s, Mbit/s) as is standard for networking.
 *
 * Every formatter returns "—" for non-finite or negative input instead of a
 * misleading number.
 */

export const UNAVAILABLE = "—";

const IEC_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
const BIT_UNITS = ["bit/s", "kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"] as const;

export interface FormattedValue {
  value: string;
  unit: string;
}

function isValidQuantity(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Formats with roughly three significant digits. Precision is chosen from the
 * *rounded* value so 9.997 becomes "10.0", not "10.00".
 */
function toSignificant(n: number): string {
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  const s = n.toFixed(digits);
  if (digits > 0 && Number(s) >= 10 ** (3 - digits)) return n.toFixed(digits - 1);
  return s;
}

export function splitBytes(bytes: number): FormattedValue {
  if (!isValidQuantity(bytes)) return { value: UNAVAILABLE, unit: "" };
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < IEC_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return { value: i === 0 ? v.toFixed(0) : toSignificant(v), unit: IEC_UNITS[i] ?? "B" };
}

export function formatBytes(bytes: number): string {
  const { value, unit } = splitBytes(bytes);
  return unit ? `${value} ${unit}` : value;
}

export function splitByteRate(bytesPerSecond: number): FormattedValue {
  const { value, unit } = splitBytes(bytesPerSecond);
  return { value, unit: unit ? `${unit}/s` : "" };
}

export function formatByteRate(bytesPerSecond: number): string {
  const { value, unit } = splitByteRate(bytesPerSecond);
  return unit ? `${value} ${unit}` : value;
}

export function splitBitRate(bytesPerSecond: number): FormattedValue {
  if (!isValidQuantity(bytesPerSecond)) return { value: UNAVAILABLE, unit: "" };
  let v = bytesPerSecond * 8;
  let i = 0;
  while (v >= 1000 && i < BIT_UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return { value: i === 0 ? v.toFixed(0) : toSignificant(v), unit: BIT_UNITS[i] ?? "bit/s" };
}

export function formatBitRate(bytesPerSecond: number): string {
  const { value, unit } = splitBitRate(bytesPerSecond);
  return unit ? `${value} ${unit}` : value;
}

/** Percentage with one decimal below 10 %, none above (e.g. "4.2", "37"). */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return UNAVAILABLE;
  const clamped = Math.max(0, percent);
  return clamped < 10 ? clamped.toFixed(1) : clamped.toFixed(0);
}

/** Frequency given in MHz, shown as GHz above 1000 MHz. */
export function formatFrequencyMHz(mhz: number): string {
  if (!isValidQuantity(mhz) || mhz === 0) return UNAVAILABLE;
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

/** Compact duration: "45s", "12m 3s", "5h 07m", "3d 4h 12m". */
export function formatDuration(totalSeconds: number): string {
  if (!isValidQuantity(totalSeconds)) return UNAVAILABLE;
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** Live-window label: "1 minute", "5 minutes", "1 hour". */
export function formatWindow(secs: number): string {
  if (secs >= 3600 && secs % 3600 === 0) return secs === 3600 ? "hour" : `${secs / 3600} hours`;
  const min = Math.round(secs / 60);
  return min === 1 ? "minute" : `${min} minutes`;
}
