import { useCallback, useEffect, useRef, useState } from "react";
import { getHistoryStatus, queryHistory } from "../../ipc/commands";
import type { AppError } from "../../ipc/errors";
import { subscribeHistoryUpdated, type Unsubscribe } from "../../ipc/events";
import type { HistoryQuery, HistoryStatus } from "../../ipc/types";
import { MAX_POINTS } from "./historyData";

export type HistoryState =
  | { status: "loading" }
  | { status: "ready"; query: HistoryQuery; info: HistoryStatus }
  | { status: "error"; error: AppError };

/**
 * Loads history for the last `rangeMs` and reloads when the range changes or
 * the backend reports a committed batch (`history://updated`). No polling.
 * Responses that arrive out of order are ignored.
 */
export function useHistory(rangeMs: number): HistoryState & { reload: () => void } {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const to = Date.now();
    const [query, info] = await Promise.all([queryHistory(to - rangeMs, to, MAX_POINTS), getHistoryStatus()]);
    if (id !== requestId.current) return; // a newer request superseded this one
    if (!query.ok) setState({ status: "error", error: query.error });
    else if (!info.ok) setState({ status: "error", error: info.error });
    else setState({ status: "ready", query: query.value, info: info.value });
  }, [rangeMs]);

  useEffect(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: Unsubscribe | null = null;
    void subscribeHistoryUpdated(() => void load()).then((u) => {
      if (disposed) u();
      else unsubscribe = u;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [load]);

  return { ...state, reload: () => void load() };
}
