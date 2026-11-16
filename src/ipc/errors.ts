/** Mirror of the Rust `AppError` serialisation (`src-tauri/src/error.rs`). */
export type AppErrorKind =
  | "invalid_argument"
  | "unsupported"
  | "not_found"
  | "permission_denied"
  | "internal"
  /** Frontend-only: the Tauri runtime is not present (e.g. opened in a plain browser). */
  | "no_backend";

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<AppErrorKind>([
  "invalid_argument",
  "unsupported",
  "not_found",
  "permission_denied",
  "internal",
  "no_backend",
]);

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.kind === "string" && KNOWN_KINDS.has(v.kind) && typeof v.message === "string";
}

/** Normalise anything thrown by `invoke` into an `AppError`. */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) return { kind: "internal", message: err.message };
  if (typeof err === "string") return { kind: "internal", message: err };
  return { kind: "internal", message: "Unknown error" };
}
