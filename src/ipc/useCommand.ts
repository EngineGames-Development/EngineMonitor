import { useCallback, useEffect, useState } from "react";
import type { CommandResult } from "./commands";
import type { AppError } from "./errors";

export type CommandState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: AppError };

/**
 * Runs a one-shot backend command on mount and exposes its state.
 * Not for live metrics: those arrive as events (see ARCHITECTURE.md).
 */
export function useCommand<T>(run: () => Promise<CommandResult<T>>): CommandState<T> & { reload: () => void } {
  const [state, setState] = useState<CommandState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    run().then((res) => {
      if (cancelled) return;
      setState(res.ok ? { status: "ready", value: res.value } : { status: "error", error: res.error });
    });
    return () => {
      cancelled = true;
    };
    // `run` must be a stable module-level function; only `nonce` retriggers.
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
