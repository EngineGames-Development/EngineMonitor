import { useMemo } from "react";
import type { NetworkUnit } from "../ipc/types";
import { formatBitRate, formatByteRate, splitBitRate, splitByteRate, type FormattedValue } from "../lib/format";
import { useSettings } from "./SettingsProvider";

export interface NetworkFormatters {
  unit: NetworkUnit;
  /** Network rate (input: bytes per second) in the user's chosen unit. */
  format: (bytesPerSecond: number) => string;
  split: (bytesPerSecond: number) => FormattedValue;
}

export function networkFormatters(unit: NetworkUnit): NetworkFormatters {
  return unit === "bits"
    ? { unit, format: formatBitRate, split: splitBitRate }
    : { unit, format: formatByteRate, split: splitByteRate };
}

export function useNetworkFormat(): NetworkFormatters {
  const unit = useSettings().settings.networkUnit;
  return useMemo(() => networkFormatters(unit), [unit]);
}
