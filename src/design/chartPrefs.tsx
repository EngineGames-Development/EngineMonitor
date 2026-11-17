import { createContext, useContext } from "react";

export interface ChartPrefs {
  /** Smoothed (monotone) curves instead of straight segments. */
  smooth: boolean;
  /** Default time window of live charts, ms. */
  liveWindowMs: number;
}

export const ChartPrefsContext = createContext<ChartPrefs>({ smooth: true, liveWindowMs: 5 * 60_000 });

export function useChartPrefs(): ChartPrefs {
  return useContext(ChartPrefsContext);
}
