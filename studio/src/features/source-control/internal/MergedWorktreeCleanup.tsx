import { useEffect, useState } from "react";
import { invalidateTaskWorktree } from "../../agents/worktrees";
import { discardMergedWorktree } from "../api";
import { invalidateCheckoutChanges } from "../queries";
import type { WorktreeCheckoutRef } from "../types";

interface MergedWorktreeCleanupProps {
  checkout: WorktreeCheckoutRef;
  uncommittedFileCount: number;
  unpushedCommitCount: number;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function MergedWorktreeCleanup({
  checkout,
  uncommittedFileCount,
  unpushedCommitCount,
}: MergedWorktreeCleanupProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirming(false);
    setError(null);
  }, [checkout.moduleId, checkout.parentId, checkout.taskId]);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await discardMergedWorktree(checkout);
      setConfirming(false);
      await Promise.all([
        invalidateCheckoutChanges(checkout),
        invalidateTaskWorktree(checkout.taskId),
      ]);
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
          className="border border-lifecycle-success/60 px-2 py-0.5 text-xs text-lifecycle-success hover:bg-pane-bg disabled:opacity-50"
        >
          Discard
        </button>
        {error ? (
          <div className="mt-1 text-xs text-lifecycle-danger">{error}</div>
        ) : null}
      </div>
    );
  }

  const hasLocalLoss = uncommittedFileCount > 0 || unpushedCommitCount > 0;
  const lossCopy = hasLocalLoss
    ? `${countLabel(uncommittedFileCount, "file")} with uncommitted changes and ${countLabel(unpushedCommitCount, "unpushed commit")} will be lost. `
    : "";

  return (
    <div className="space-y-1 text-xs text-text-secondary">
      <div>
        Discard this worktree? {lossCopy}This removes the checkout, local branch,
        and remote-tracking ref.
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
