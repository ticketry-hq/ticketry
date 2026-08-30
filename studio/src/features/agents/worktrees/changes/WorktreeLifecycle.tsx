import { useState } from "react";

export interface WorkItemClosureFailureValue {
  code: string;
  message: string;
  from_state?: string | null;
  to_state?: string | null;
}

export interface WorktreeCleanupValue {
  eligible: boolean;
  blocker?: string | null;
  reason?: string | null;
}

export function WorktreeLifecycle({
  closureFailure,
  cleanup,
  onCleanup,
}: {
  closureFailure?: WorkItemClosureFailureValue | null;
  cleanup?: WorktreeCleanupValue | null;
  onCleanup: (operationId: string) => Promise<void>;
}) {
  const [operationId, setOperationId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const beginCleanup = () => {
    setOperationId((current) => current ?? crypto.randomUUID());
    setError(null);
    setConfirming(true);
  };

  const confirmCleanup = async () => {
    const intent = operationId ?? crypto.randomUUID();
    setOperationId(intent);
    setBusy(true);
    setError(null);
    try {
      await onCleanup(intent);
      setCompleted(true);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local worktree cleanup failed.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {closureFailure ? (
        <div
          aria-label="Work Item closure failure"
          className="border border-lifecycle-danger/50 bg-lifecycle-danger/10 px-2 py-1.5 text-xs text-lifecycle-danger"
          role="alert"
        >
          <span className="font-medium">Merged, but the Work Item could not move to Done.</span>{" "}
          <span>{closureFailure.message}</span>
        </div>
      ) : null}

      {cleanup?.reason ? (
        <div
          aria-label="Worktree cleanup status"
          className="border border-pane-border bg-pane-title/30 px-2 py-1.5 text-xs text-text-muted"
        >
          {cleanup.reason}
        </div>
      ) : null}

      {cleanup?.eligible && !completed ? (
        <button
          type="button"
          disabled={busy}
          onClick={beginCleanup}
          className="border border-lifecycle-danger/60 px-2 py-1 text-lifecycle-danger disabled:opacity-50"
        >
          Cleanup local worktree
        </button>
      ) : null}

      {confirming ? (
        <div
          aria-label="Confirm local worktree cleanup"
          className="border border-lifecycle-danger/50 bg-lifecycle-danger/10 p-2 text-xs"
          role="group"
        >
          <p className="text-text-primary">
            Remove the local task checkout, local task branch, and Ticketry mapping? The remote branch and pull request stay on GitHub.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmCleanup()}
              className="border border-lifecycle-danger/60 px-2 py-1 text-lifecycle-danger disabled:opacity-50"
            >
              {busy ? "Cleaning up..." : "Confirm cleanup"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-lifecycle-danger" role="alert">{error}</p> : null}
      {completed ? (
        <p className="text-xs text-lifecycle-success" role="status">
          Local worktree cleanup completed.
        </p>
      ) : null}
    </div>
  );
}
