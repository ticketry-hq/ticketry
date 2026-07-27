import { useCallback, useEffect, useState } from "react";
import {
  createWorktree,
  discardWorktree,
  getWorktree,
  type WorktreeContext,
  type WorktreeStatus,
} from "./internal/api";

interface WorktreeBlockProps {
  taskId: string;
  parentId?: string | null;
  moduleId?: string | null;
  projectId?: string | null;
  ticketSeq?: number | null;
  taskName?: string | null;
}

/**
 * Opt-in worktree surface (ticket #589). The shared issue Details panel owns
 * its placement for every Task workspace host.
 *
 * Renders one of four states from the server's discriminated WorktreeStatus:
 *   - none      → a "+ Create worktree" button (the opt-in),
 *   - worktree  → read-only branch/base/clean·dirty/ahead·behind + Discard,
 *   - conflict  → a display-only resolve-in-worktree line (primary untouched),
 *   - no_repo   → a "changes not isolated" note with no controls.
 *
 * There is no "Land it" control: integration fires automatically when the
 * task is marked Done (a backend close hook). Local state only — one fetch on
 * mount / task change, refetched after Create and Discard.
 */
export function WorktreeBlock({
  taskId,
  parentId,
  moduleId,
  projectId,
  ticketSeq,
  taskName,
}: WorktreeBlockProps) {
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const ctx: WorktreeContext = {
    parentId,
    moduleId,
    projectId,
    ticketSeq,
    taskName,
  };

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getWorktree(taskId, { parentId, moduleId }));
    } catch {
      setError("Could not load worktree status");
    }
    // ctx fields other than parent/module aren't used by the GET.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, parentId, moduleId]);

  useEffect(() => {
    setStatus(null);
    setConfirming(false);
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await createWorktree(taskId, ctx));
    } catch {
      setError("Create failed");
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    setBusy(true);
    setError(null);
    try {
      await discardWorktree(taskId, { parentId, moduleId });
      setConfirming(false);
      await refresh();
    } catch {
      setError("Discard failed");
    } finally {
      setBusy(false);
    }
  };

  const labelCls = "text-text-muted";
  const monoCls = "font-mono text-text-primary";

  let body: React.ReactNode;

  if (!status) {
    body = <span className="text-text-muted">…</span>;
  } else if (status.kind === "no_repo") {
    body = (
      <div className="text-text-muted">
        Changes are not isolated — no git repo encloses this task's path, so
        there's nothing to create. Runs work directly in the path.
      </div>
    );
  } else if (status.is_shared) {
    body = (
      <div className="text-text-muted">
        Shares the worktree of its parent task ({status.top_level_task_id}).
      </div>
    );
  } else if (status.kind === "none") {
    body = (
      <div className="flex items-center gap-2">
        <span className="text-text-muted">Runs in the primary checkout.</span>
        <button
          type="button"
          disabled={busy}
          onClick={onCreate}
          className="border border-focus-accent px-2 py-0.5 text-text-primary hover:bg-pane-bg disabled:opacity-50"
        >
          + Create worktree
        </button>
      </div>
    );
  } else if (status.conflict) {
    // kind=worktree, in conflict after an auto-land attempt.
    body = (
      <div className="space-y-1">
        <div className="text-lifecycle-danger">Conflict</div>
        <div className="text-text-muted">
          Auto-land hit a merge conflict. Resolve it{" "}
          <span className="text-text-primary">in the worktree</span> and commit
          — your primary checkout is untouched. Re-marking the task Done
          retries.
        </div>
        <div className={monoCls}>{status.path}</div>
        {renderDiscard()}
      </div>
    );
  } else {
    // kind=worktree, active.
    body = (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={monoCls}>
            {status.branch} → {status.base_branch}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={status.dirty ? "text-lifecycle-attention" : "text-lifecycle-success"}>
            {status.dirty ? "dirty" : "clean"}
          </span>
          <span className="text-text-muted">↑{status.ahead ?? 0}</span>
          <span className="text-text-muted">↓{status.behind ?? 0}</span>
          <span className="text-text-muted">· lands automatically on Done</span>
        </div>
        {renderDiscard()}
      </div>
    );
  }

  function renderDiscard(): React.ReactNode {
    if (confirming) {
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">Discard — work is thrown away?</span>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
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
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="border border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-lifecycle-danger hover:text-lifecycle-danger disabled:opacity-50"
      >
        Discard
      </button>
    );
  }

  return (
    <div
      className="mt-3 border border-pane-border bg-pane-bg/40 p-2 text-xs"
      data-testid="worktree-block"
    >
      <div className={`mb-1 ${labelCls}`}>Worktree</div>
      {body}
      {error ? <div className="mt-1 text-lifecycle-danger">{error}</div> : null}
    </div>
  );
}
