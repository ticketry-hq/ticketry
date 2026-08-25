import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createWorktree,
  getWorktree,
  type WorktreeContext,
} from "./internal/api";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import { useWorkItem } from "../../work-items";
import { WorktreeDiscardControl } from "./WorktreeDiscardControl";
import { invalidateTaskWorktree } from "./queries";

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
 * writes its authoritative response through and Discard refetches the key.
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

  const ctx: WorktreeContext = {
    parentId,
    moduleId,
    projectId,
    ticketSeq,
    taskName,
  };

  const statusKey = queryKeys.worktrees.status(taskId, parentId, moduleId);
  const statusQuery = useQuery(
    {
      queryKey: statusKey,
      queryFn: ({ signal }) =>
        getWorktree(taskId, { parentId, moduleId }, signal),
    },
    queryClient,
  );
  const status = statusQuery.data ?? null;
  const sharedOwner = useWorkItem(
    status?.is_shared ? status.top_level_task_id : null,
  ).data;
  const error =
    mutationError ??
    (statusQuery.isError ? "Could not load worktree status" : null);

  useEffect(() => {
    setMutationError(null);
  }, [moduleId, parentId, taskId]);

  const onCreate = async () => {
    setBusy(true);
    setMutationError(null);
    try {
      queryClient.setQueryData(statusKey, await createWorktree(taskId, ctx));
      await invalidateTaskWorktree(taskId, projectId, moduleId);
    } catch {
      setMutationError("Create failed");
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
        Shares the worktree of its parent task
        {sharedOwner ? ` (${sharedOwner.key} · ${sharedOwner.name})` : ""}.
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
          <span className="text-text-primary">in the worktree</span> and commit.
          Your primary checkout is untouched. Re-marking the task Done retries.
        </div>
        <div className={monoCls}>{status.path}</div>
        <WorktreeDiscardControl
          status={status}
          parentId={parentId}
          moduleId={moduleId}
        />
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
        <WorktreeDiscardControl
          status={status}
          parentId={parentId}
          moduleId={moduleId}
        />
      </div>
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
