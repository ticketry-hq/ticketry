import { useEffect, useState } from "react";
import { discardWorktree, type WorktreeStatus } from "./internal/api";
import { invalidateTaskWorktree } from "./queries";

interface WorktreeDiscardControlProps {
  status: WorktreeStatus;
  parentId?: string | null;
  moduleId?: string | null;
}

export function WorktreeDiscardControl({
  status,
  parentId,
  moduleId,
}: WorktreeDiscardControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [moduleId, parentId, status.task_id]);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await discardWorktree(status.task_id, { parentId, moduleId });
      setConfirming(false);
      await invalidateTaskWorktree(status.task_id);
    } catch {
      setError("Discard failed");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="border border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-lifecycle-danger hover:text-lifecycle-danger disabled:opacity-50"
        >
          Discard
        </button>
        {error ? (
          <div className="mt-1 text-xs text-lifecycle-danger">{error}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="text-text-muted">
        {status.dirty
          ? "Discard this dirty worktree? Uncommitted changes will be lost."
          : "Discard this worktree?"}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void discard()}
          className="border border-lifecycle-danger px-2 py-0.5 text-lifecycle-danger hover:bg-pane-bg disabled:opacity-50"
        >
          Yes, discard
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="border border-pane-border px-2 py-0.5 text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
      {error ? <div className="text-lifecycle-danger">{error}</div> : null}
    </div>
  );
}
