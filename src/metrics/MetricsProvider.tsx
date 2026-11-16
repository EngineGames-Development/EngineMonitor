import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import { getLatestSnapshot, getSystemInfo } from "../ipc/commands";
import { subscribeSnapshots, type Unsubscribe } from "../ipc/events";
import { initialMetricsState, metricsReducer, type MetricsState } from "./store";

const MetricsContext = createContext<MetricsState | null>(null);

/** How often staleness is re-evaluated. A UI timer only; it does not call the backend. */
const STALE_CHECK_MS = 1_000;

/**
 * Owns the single subscription to `metrics://snapshot` for the whole app.
 * Pages read from context and never subscribe themselves.
 */
export function MetricsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(metricsReducer, undefined, () => initialMetricsState());

  useEffect(() => {
    let disposed = false;
    let unsubscribe: Unsubscribe | null = null;

    (async () => {
      // Subscribe first so no tick is missed between hydrate and listen.
      const unsub = await subscribeSnapshots((event) =>
        dispatch({ type: "event", event, now: performance.now() }),
      );
      if (disposed) {
        unsub(); // unmounted while registering (e.g. React StrictMode double-mount)
        return;
      }
      unsubscribe = unsub;

      const info = await getSystemInfo();
      if (disposed) return;
      if (!info.ok) {
        dispatch({ type: "error", error: info.error });
        return;
      }
      dispatch({ type: "info", info: info.value });

      const latest = await getLatestSnapshot();
      if (disposed) return;
      if (!latest.ok) dispatch({ type: "error", error: latest.error });
      else if (latest.value) dispatch({ type: "event", event: latest.value, now: performance.now() });
    })().catch((err: unknown) => {
      if (!disposed) {
        dispatch({
          type: "error",
          error: { kind: "internal", message: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    const timer = window.setInterval(() => dispatch({ type: "tick", now: performance.now() }), STALE_CHECK_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, []);

  return <MetricsContext.Provider value={state}>{children}</MetricsContext.Provider>;
}

export function useMetrics(): MetricsState {
  const ctx = useContext(MetricsContext);
  if (!ctx) throw new Error("useMetrics must be used inside <MetricsProvider>");
  return ctx;
}
