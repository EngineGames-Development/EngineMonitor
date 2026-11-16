import { useState, type ReactNode } from "react";
import { Button, Card, Dialog, Icon } from "../../design";
import { terminateProcess } from "../../ipc/commands";
import type { AppError } from "../../ipc/errors";
import type { ProcessSample } from "../../ipc/types";
import { formatByteRate, formatBytes, formatDuration, formatPercent, UNAVAILABLE } from "../../lib/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1.5">
      <dt className="text-2xs tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="selectable tabular mt-0.5 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

export function formatStartTime(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const ERROR_TITLES: Partial<Record<AppError["kind"], string>> = {
  permission_denied: "Access denied",
  not_found: "Process no longer exists",
  invalid_argument: "Not allowed",
};

export interface ProcessDetailProps {
  /** null when the selected process has exited. */
  process: ProcessSample | null;
  isSelf: boolean;
  parent: ProcessSample | null;
  onSelect: (p: ProcessSample) => void;
  onClose: () => void;
  onTerminated: (p: ProcessSample) => void;
}

export function ProcessDetail({ process: p, isSelf, parent, onSelect, onClose, onTerminated }: ProcessDetailProps) {
  // The process shown in the dialog is frozen when the dialog opens, so the
  // PID/start time sent to the backend is exactly what the user confirmed.
  const [confirming, setConfirming] = useState<ProcessSample | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function confirm() {
    if (!confirming) return;
    setPending(true);
    setError(null);
    const res = await terminateProcess(confirming.pid, confirming.startTimeSecs);
    setPending(false);
    if (res.ok) {
      const ended = confirming;
      setConfirming(null);
      onTerminated(ended);
    } else {
      setError(res.error);
    }
  }

  function closeDialog() {
    if (pending) return;
    setConfirming(null);
    setError(null);
  }

  return (
    <Card
      title="Details"
      className="w-80 shrink-0 self-start"
      actions={
        <button type="button" onClick={onClose} aria-label="Close details" className="text-fg-muted hover:text-fg">
          <Icon name="close" size={15} />
        </button>
      }
    >
      {p === null ? (
        <p className="text-sm text-fg-muted">This process has exited.</p>
      ) : (
        <>
          <h3 className="selectable truncate font-display text-base font-semibold text-fg" title={p.name}>
            {p.name}
          </h3>
          <dl className="mt-2 divide-y divide-line">
            <Row label="PID">{p.pid}</Row>
            <Row label="Parent">
              {p.parentPid === null ? (
                UNAVAILABLE
              ) : parent ? (
                <button type="button" className="text-primary hover:underline" onClick={() => onSelect(parent)}>
                  {parent.name} ({p.parentPid})
                </button>
              ) : (
                `${p.parentPid} (not running)`
              )}
            </Row>
            <Row label="Executable">
              {p.exe ?? <span className="text-fg-muted">Not available — protected or owned by another user</span>}
            </Row>
            <Row label="Status">
              <span className="capitalize">{p.status}</span>
            </Row>
            <Row label="CPU">{p.cpuPercent === null ? "Measuring…" : `${formatPercent(p.cpuPercent)} % of total`}</Row>
            <Row label="Memory (resident)">{formatBytes(p.memoryBytes)}</Row>
            <Row label="Virtual memory">{formatBytes(p.virtualMemoryBytes)}</Row>
            <Row label="Disk read · write">
              {p.diskReadBytesPerSec === null ? UNAVAILABLE : formatByteRate(p.diskReadBytesPerSec)} ·{" "}
              {p.diskWriteBytesPerSec === null ? UNAVAILABLE : formatByteRate(p.diskWriteBytesPerSec)}
            </Row>
            <Row label="Started">{formatStartTime(p.startTimeSecs)}</Row>
            <Row label="Running for">{formatDuration(p.runTimeSecs)}</Row>
          </dl>
          <div className="mt-4">
            <Button variant="danger" size="sm" icon="close" disabled={isSelf} onClick={() => setConfirming(p)}>
              End process
            </Button>
            {isSelf && <p className="mt-1.5 text-xs text-fg-subtle">Close the window to quit EngineMonitor.</p>}
          </div>
        </>
      )}

      <Dialog
        open={confirming !== null}
        title={`End ${confirming?.name ?? "process"}?`}
        tone="danger"
        onClose={closeDialog}
        actions={
          <>
            <Button data-autofocus onClick={closeDialog} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} disabled={pending}>
              {pending ? "Ending…" : "End process"}
            </Button>
          </>
        }
      >
        {confirming && (
          <>
            <p>
              PID <span className="tabular text-fg">{confirming.pid}</span>, started{" "}
              {formatStartTime(confirming.startTimeSecs)}.
            </p>
            <p className="mt-2">
              The process is stopped immediately. Unsaved work in it will be lost. The operating system may refuse if
              the process is protected or runs with higher privileges.
            </p>
            {error && (
              <div role="alert" className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-fg">
                <div className="font-medium">{ERROR_TITLES[error.kind] ?? "Could not end the process"}</div>
                <div className="mt-0.5 text-xs text-fg-muted">{error.message}</div>
              </div>
            )}
          </>
        )}
      </Dialog>
    </Card>
  );
}
