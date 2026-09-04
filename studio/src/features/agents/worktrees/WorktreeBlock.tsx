import { useEffect, useRef, useState } from "react";
import { useQuery } from "@apollo/client/react";
import {
  adaptWorktreeStatus,
  type WorktreeStatusPayload,
} from "./internal/statusTransport";
import {
  newOperationId,
  requestWorktreeCreate,
} from "./internal/createTransport";
import { requestWorktreeDiscard } from "./internal/discardTransport";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  SELECTION_DELAY_MS,
  useDelayedSelectionId,
} from "../../../shared/selection/useDelayedSelectionId";
import {
  WorktreeStatusDocument,
  type WorktreeStatusQuery,
} from "./generated/worktreeStatus.documents";
import type { WorktreeStatus } from "./internal/types";

interface WorktreeBlockProps {
  taskId: string;
}

function worktreeQueryData(status: WorktreeStatus): WorktreeStatusQuery {
  return {
    worktree_status: {
      __typename: "WorktreeStatusView",
      ...status,
    },
  } as unknown as WorktreeStatusQuery;
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
export function WorktreeBlock({ taskId }: WorktreeBlockProps) {
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const latestTaskId = useRef(taskId);
  latestTaskId.current = taskId;

  const client = studioApolloClient();
  // Each status read runs a live `git status` in Rust. Let rapid task changes
  // settle so intermediate selections do not start work that no one will see.
  const queryTaskId = useDelayedSelectionId(taskId, SELECTION_DELAY_MS);
  const statusQuery = useQuery(WorktreeStatusDocument, {
    client,
    variables: { taskId: queryTaskId ?? taskId },
    skip: queryTaskId === null,
    // Rust answers from the top-level owner's row, but Apollo caches each
    // requested task id separately. Reconcile that identity on every mount.
    fetchPolicy: "cache-and-network",
  });
  const status = queryTaskId === taskId && statusQuery.data
    ? adaptWorktreeStatus(
      statusQuery.data.worktree_status as WorktreeStatusPayload,
    )
    : null;
  const error =
    mutationError ??
    (queryTaskId === taskId && statusQuery.error
      ? "Could not load worktree status"
      : null);

  useEffect(() => {
    setBusy(false);
    setConfirming(false);
    setMutationError(null);
  }, [taskId]);

  const onCreate = async () => {
    setBusy(true);
    setMutationError(null);
    // One identity per intent: a retry of this click is the same operation and
    // converges on the same worktree rather than cutting a second branch.
    const operationId = newOperationId();
    try {
      const created = await requestWorktreeCreate(taskId, operationId);
      client.writeQuery<WorktreeStatusQuery>({
        query: WorktreeStatusDocument,
        variables: { taskId },
        data: worktreeQueryData(created),
      });
    } catch {
      if (latestTaskId.current === taskId) {
        setMutationError("Create failed");
      }
    } finally {
      if (latestTaskId.current === taskId) setBusy(false);
    }
  };

  const onDiscard = async () => {
    setBusy(true);
    setMutationError(null);
    // One identity per confirmed intent: a retry of this click replays the
    // same durable removal rather than throwing anything else away.
    const operationId = newOperationId();
    try {
      const result = await requestWorktreeDiscard(taskId, operationId);
      if (latestTaskId.current === taskId) setConfirming(false);
      // The mutation's own response is authoritative for this window; a
      // transport that cannot answer with one falls back to a refetch.
      if (result.status) {
        client.writeQuery<WorktreeStatusQuery>({
          query: WorktreeStatusDocument,
          variables: { taskId },
          data: worktreeQueryData(result.status),
        });
      } else if (latestTaskId.current === taskId) {
        await statusQuery.refetch();
      }
    } catch {
      if (latestTaskId.current === taskId) {
        setMutationError("Discard failed");
      }
    } finally {
      if (latestTaskId.current === taskId) setBusy(false);
    }
  };

  const labelCls = "text-text-muted";
  const monoCls = "min-w-0 break-all font-mono text-text-primary";

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
        {status.is_shared ? (
          <div className="text-text-muted">
            Shares the worktree owned by top-level task ({status.top_level_task_id}).
          </div>
        ) : null}
        <div className="text-text-muted">
          Auto-land hit a merge conflict. Resolve it{" "}
          <span className="text-text-primary">in the worktree</span> and commit
          — your primary checkout is untouched. Re-marking the task Done
          retries.
        </div>
        <div className={monoCls}>{status.path}</div>
        {status.is_shared ? null : renderDiscard()}
      </div>
    );
  } else if (status.is_shared) {
    body = (
      <div className="text-text-muted">
        Shares the worktree owned by top-level task ({status.top_level_task_id}).
      </div>
    );
  } else {
    // kind=worktree, active.
    body = (
      <div className="space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
      className="mt-3 min-w-0 border border-pane-border bg-pane-bg/40 p-2 text-xs"
      data-testid="worktree-block"
    >
      <div className={`mb-1 ${labelCls}`}>Worktree</div>
      {body}
      {error ? <div className="mt-1 text-lifecycle-danger">{error}</div> : null}
    </div>
  );
}
