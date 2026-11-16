import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HISTORY_UPDATED_EVENT, SNAPSHOT_EVENT, type SnapshotEvent } from "./types";

export type Unsubscribe = () => void;

/**
 * Subscribes to backend snapshots. Resolves once the listener is registered.
 * The returned function must be called to unsubscribe (component unmount).
 */
export async function subscribeSnapshots(handler: (event: SnapshotEvent) => void): Promise<Unsubscribe> {
  if (!isTauri()) return () => {};
  const unlisten = await listen<SnapshotEvent>(SNAPSHOT_EVENT, (e) => handler(e.payload));
  return unlisten;
}

/** Notified after the history writer commits a batch (payload-free). */
export async function subscribeHistoryUpdated(handler: () => void): Promise<Unsubscribe> {
  if (!isTauri()) return () => {};
  return listen(HISTORY_UPDATED_EVENT, () => handler());
}
