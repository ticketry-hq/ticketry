import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type WorktreeContext } from "./internal/api";
import { readWorktreeStatus } from "./internal/statusTransport";
import {
  newOperationId,
  requestWorktreeCreate,
} from "./internal/createTransport";
import { requestWorktreeDiscard } from "./internal/discardTransport";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

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
 * task is marked Done (a backend close hook). Query owns status reads; Create
 * and Discard each write their own authoritative response through the key.
 *
 * Discard stays explicitly confirmed: the first click asks, and only the
 * second one sends. The request itself carries no path, branch, or repository
 * — the runtime removes exactly the checkout Ticketry indexed.
 */
export function WorktreeBlock({
  taskId,
  parentId,
  moduleId,
  projectId,
  ticketSeq,
  taskName,
}: WorktreeBlockProps) {
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const ctx: WorktreeContext = {
    parentId,
    moduleId,
    projectId,
    ticketSeq,
    taskName,
  };

  // The checkout belongs to the top-level Work Item, so the holding is keyed
  // by the owner rather than by whichever descendant this view is showing. A
  // durable fact names that owner, which is how a parent window and a child
  // window looking at one checkout converge on one result.
  const ownerId = parentId ?? taskId;
  const statusKey = queryKeys.worktrees.status(ownerId, taskId, moduleId);
  const statusQuery = useQuery(
    {
      queryKey: statusKey,
      queryFn: ({ signal }) =>
        readWorktreeStatus(taskId, { parentId, moduleId }, signal),
    },
    queryClient,
  );
  const status = statusQuery.data ?? null;
  const error =
    mutationError ??
    (statusQuery.isError ? "Could not load worktree status" : null);

  useEffect(() => {
    setConfirming(false);
    setMutationError(null);
  }, [moduleId, parentId, taskId]);

  const onCreate = async () => {
    setBusy(true);
    setMutationError(null);
    // One identity per intent: a retry of this click is the same operation and
    // converges on the same worktree rather than cutting a second branch.
    const operationId = newOperationId();
    try {
      queryClient.setQueryData(
        statusKey,
        await requestWorktreeCreate(taskId, operationId, ctx),
      );
    } catch {
      setMutationError("Create failed");
    } finally {
      setBusy(false);
    }
  };

  const onDiscard = async () => {
    setBusy(true);
    setMutationError(null);
    // One identity per confirmed intent: a retry of this click replays the
    // same durable removal rather than throwing anything else away.
    const operationId = newOperationId();
    try {
      const result = await requestWorktreeDiscard(taskId, operationId, ctx);
      setConfirming(false);
      // The mutation's own response is authoritative for this window; a
      // transport that cannot answer with one falls back to a refetch.
      if (result.status) {
        queryClient.setQueryData(statusKey, result.status);
      } else {
        await statusQuery.refetch();
      }
    } catch {
      setMutationError("Discard failed");
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
