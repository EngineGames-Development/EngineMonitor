import { useEffect, useState } from "react";
import { Button, Card, Dialog } from "../../design";
import { clearHistory, setHistorySettings } from "../../ipc/commands";
import type { AppError } from "../../ipc/errors";
import type { HistorySettings, HistoryStatus } from "../../ipc/types";
import { formatBytes } from "../../lib/format";

const INTERVALS = [1, 2, 5, 10, 30, 60] as const;
const RETENTIONS = [1, 3, 7, 14, 30, 90, 180, 365] as const;

/** Same estimate as the backend (`HistorySettings::estimated_size_bytes`). */
export function estimateSizeBytes(s: HistorySettings): number {
  return Math.floor((s.retentionDays * 86_400) / Math.max(1, s.intervalSecs)) * 100;
}

function selectClass() {
  return "h-8 rounded-md border border-line-strong bg-raised px-2 text-sm text-fg focus:border-primary focus:outline-none";
}

export function HistorySettingsCard({ info, onChanged }: { info: HistoryStatus; onChanged: () => void }) {
  const [draft, setDraft] = useState<HistorySettings>(info.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState<AppError | null>(null);

  // Follow external changes (e.g. after save) without clobbering edits in progress.
  const s = info.settings;
  useEffect(() => {
    setDraft(s);
    // Depend on the values, not the object identity, which changes every reload.
  }, [s.enabled, s.intervalSecs, s.retentionDays]);

  const dirty =
    draft.enabled !== s.enabled || draft.intervalSecs !== s.intervalSecs || draft.retentionDays !== s.retentionDays;
  const shrinking = draft.retentionDays < s.retentionDays;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const r = await setHistorySettings(draft);
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      onChanged();
    } else {
      setError(r.error);
    }
  }

  async function doClear() {
    setClearError(null);
    const r = await clearHistory();
    if (r.ok) {
      setConfirmClear(false);
      onChanged();
    } else {
      setClearError(r.error);
    }
  }

  return (
    <Card title="Recording & retention">
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-fg">Record history</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="size-4 accent-[var(--em-primary)]"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-fg">Recording interval</span>
          <select
            className={selectClass()}
            value={draft.intervalSecs}
            onChange={(e) => setDraft({ ...draft, intervalSecs: Number(e.target.value) })}
          >
            {INTERVALS.map((v) => (
              <option key={v} value={v}>
                {v} s
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-fg">Keep history for</span>
          <select
            className={selectClass()}
            value={draft.retentionDays}
            onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })}
          >
            {RETENTIONS.map((v) => (
              <option key={v} value={v}>
                {v === 1 ? "1 day" : `${v} days`}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-fg-subtle">
          Estimated size at full retention: about {formatBytes(estimateSizeBytes(draft))}. Each point is the average
          of the live samples in one interval.
        </p>
        {shrinking && (
          <p className="text-xs text-warning">History older than {draft.retentionDays} days will be deleted when you save.</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error.message}
          </p>
        )}
        {saved && !dirty && <p className="text-xs text-success">Saved.</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
            Clear history…
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
        <dt className="text-fg-muted">Stored points</dt>
        <dd className="tabular text-right text-fg">{info.stats.rows.toLocaleString()}</dd>
        <dt className="text-fg-muted">Database size</dt>
        <dd className="tabular text-right text-fg">{formatBytes(info.stats.sizeBytes)}</dd>
        <dt className="text-fg-muted">Oldest</dt>
        <dd className="tabular text-right text-fg">
          {info.stats.oldestMs === null ? "—" : new Date(info.stats.oldestMs).toLocaleString()}
        </dd>
      </dl>
      {info.lastError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Last write failed: {info.lastError}
        </p>
      )}

      <Dialog
        open={confirmClear}
        title="Clear all history?"
        tone="danger"
        onClose={() => setConfirmClear(false)}
        actions={
          <>
            <Button data-autofocus onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doClear}>
              Clear history
            </Button>
          </>
        }
      >
        <p>
          All {info.stats.rows.toLocaleString()} recorded points will be permanently deleted. Live monitoring and your
          settings are not affected. This cannot be undone.
        </p>
        {clearError && (
          <p role="alert" className="mt-2 text-danger">
            {clearError.message}
          </p>
        )}
      </Dialog>
    </Card>
  );
}
