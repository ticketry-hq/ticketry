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
  WorktreeStatusDocument,
  type WorktreeStatusQuery,
} from "./generated/worktreeStatus.documents";
import type { WorktreeStatus } from "./internal/types";
import {
  moduleFolderSaveError,
  prepareDirectoryTrust,
} from "../../module-links";
import {
  clearWorktreeTrustDeferral,
  deferWorktreeTrust,
  isWorktreeTrustDeferred,
} from "./worktreeTrustDeferrals";
import { IconGitBranch } from "../../../shared/ui/icons";
import Popover from "../../../shared/ui/Popover";

const DEFERRED_TRUST_ERROR =
  "Worktree trust was not approved. Retry to continue.";

interface WorktreeTrustOutcome {
  failure: string | null;
  deferred: boolean;
}

async function prepareWorktreeTrust(path: string): Promise<WorktreeTrustOutcome> {
  try {
    const approved = await prepareDirectoryTrust(path, undefined, {
      title: "Trust worktree?",
      subject: "worktree",
      confirmLabel: "Trust worktree",
    });
    return {
      failure: approved ? null : DEFERRED_TRUST_ERROR,
      deferred: !approved,
    };
  } catch (cause) {
    return {
      failure: moduleFolderSaveError(
        cause,
        "Could not prepare worktree trust. Retry to continue.",
      ),
      deferred: false,
    };
  }
}

interface WorktreeBlockProps {
  taskId: string;
  parentId?: string | null;
  moduleId?: string | null;
  onViewChanges?: () => void;
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
 * Opt-in worktree surface (ticket #589). The selected issue document owns its
 * placement for every task workspace host.
 *
 * A compact toolbar control over the server's discriminated WorktreeStatus:
 *   - none      → a "+ Worktree" button (the opt-in),
 *   - worktree  → a branch chip that opens Changes, with a details popover
 *                 holding base/clean·dirty/ahead·behind, the path and Discard,
 *   - conflict  → the same chip in the danger tone (primary untouched),
 *   - no_repo   → nothing; runs use the module path.
 *
 * Work Item completion does not mutate this checkout. Query owns status reads;
 * Create and Discard each write their own authoritative response through the
 * key.
 *
 * Discard stays explicitly confirmed: the first click asks, and only the
 * second one sends. The request itself carries no path, branch, or repository
 * — the runtime removes exactly the checkout Ticketry indexed.
 */
export function WorktreeBlock({
  taskId,
  parentId,
  moduleId,
  onViewChanges,
}: WorktreeBlockProps) {
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inspection = useRef<{
    key: string;
    result: Promise<WorktreeTrustOutcome>;
  } | null>(null);

  const client = studioApolloClient();
  const statusQuery = useQuery(WorktreeStatusDocument, {
    client,
    variables: { taskId },
  });
  const status = statusQuery.data
    ? adaptWorktreeStatus(
      statusQuery.data.worktree_status as WorktreeStatusPayload,
    )
    : null;
  const error =
    trustError ?? mutationError ??
    (statusQuery.error ? "Could not load worktree status" : null);

  useEffect(() => {
    setConfirming(false);
    setMutationError(null);
    setTrustError(null);
  }, [moduleId, parentId, taskId]);

  const worktreePath = status?.kind === "worktree"
    ? status.path
    : null;
  const statusKind = status?.kind ?? null;

  useEffect(() => {
    if (!worktreePath) {
      inspection.current = null;
      if (statusKind) clearWorktreeTrustDeferral(taskId);
      return;
    }
    if (isWorktreeTrustDeferred(taskId, worktreePath)) {
      inspection.current = null;
      setTrustError(DEFERRED_TRUST_ERROR);
      setTrustBusy(false);
      return;
    }
    const key = `${taskId}\0${worktreePath}`;
    if (inspection.current?.key !== key) {
      inspection.current = {
        key,
        result: prepareWorktreeTrust(worktreePath),
      };
    }
    const current = inspection.current;
    let active = true;
    setTrustBusy(true);
    void current.result.then((outcome) => {
      if (!active) return;
      if (outcome.deferred) {
        deferWorktreeTrust(taskId, worktreePath);
      } else {
        clearWorktreeTrustDeferral(taskId, worktreePath);
      }
      setTrustError(outcome.failure);
      setTrustBusy(false);
    });
    return () => { active = false; };
  }, [statusKind, taskId, worktreePath]);

  const retryTrust = async () => {
    if (!worktreePath) return;
    clearWorktreeTrustDeferral(taskId, worktreePath);
    const result = prepareWorktreeTrust(worktreePath);
    inspection.current = { key: `${taskId}\0${worktreePath}`, result };
    setTrustBusy(true);
    setTrustError(null);
    const outcome = await result;
    if (inspection.current?.result !== result) return;
    if (outcome.deferred) {
      deferWorktreeTrust(taskId, worktreePath);
    } else {
      clearWorktreeTrustDeferral(taskId, worktreePath);
    }
    setTrustError(outcome.failure);
    setTrustBusy(false);
  };

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
      const result = await requestWorktreeDiscard(taskId, operationId);
      setConfirming(false);
      // The mutation's own response is authoritative for this window; a
      // transport that cannot answer with one falls back to a refetch.
      if (result.status) {
        client.writeQuery<WorktreeStatusQuery>({
          query: WorktreeStatusDocument,
          variables: { taskId },
          data: worktreeQueryData(result.status),
        });
      } else {
        await statusQuery.refetch();
      }
    } catch {
      setMutationError("Discard failed");
    } finally {
      setBusy(false);
    }
  };

  const isWorktree = status?.kind === "worktree";
  const canManage = isWorktree && !status.is_shared;
  const tone = !isWorktree
    ? "bg-text-muted"
    : status.conflict
      ? "bg-lifecycle-danger"
      : status.dirty
        ? "bg-lifecycle-attention"
        : "bg-lifecycle-success";

  let summary: React.ReactNode = null;
  if (status?.kind === "worktree") {
    if (status.is_shared) {
      summary = "Shared with its parent work item";
    } else if (status.conflict) {
      summary = <span className="text-lifecycle-danger">Conflict, resolve before shipping</span>;
    } else {
      summary = (
        <>
          <span className={status.dirty ? "text-lifecycle-attention" : "text-lifecycle-success"}>
            {status.dirty ? "Dirty" : "Clean"}
          </span>
          <span>
            ↑{status.ahead ?? 0} ↓{status.behind ?? 0} vs {status.base_branch ?? "base"}
          </span>
          <span>Completion keeps the worktree</span>
        </>
      );
    }
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

  // Nothing to offer until status loads, or when the module has no repository.
  if (!error && status?.kind !== "none" && !isWorktree) return null;

  return (
    <div
      className="inline-flex items-center gap-2 text-sm"
      data-testid="worktree-block"
    >
      {status?.kind === "none" && (
        <button
          type="button"
          disabled={busy}
          onClick={onCreate}
          title="Create an isolated worktree for this item"
          className="inline-flex h-7 items-center gap-1.5 border border-pane-border px-2.5 text-sm text-text-primary hover:border-focus-accent disabled:opacity-50"
        >
          <IconGitBranch size={14} className="text-text-muted" />
          {busy ? "Creating…" : "+ Worktree"}
        </button>
      )}
      {isWorktree && (
        <span className="inline-flex h-7 items-stretch border border-pane-border">
          <button
            type="button"
            onClick={onViewChanges}
            disabled={!onViewChanges}
            aria-label={`View changes on ${status.branch ?? "worktree"}`}
            title="View changes"
            className="inline-flex min-w-0 items-center gap-2 px-2.5 hover:bg-pane-title"
          >
            <span className={`h-2 w-2 flex-none ${tone}`} aria-hidden="true" />
            <IconGitBranch size={14} className="flex-none text-text-muted" />
            <span className="max-w-[14rem] truncate font-mono text-sm text-text-primary">
              {status.branch ?? "Worktree"}
            </span>
            {!status.is_shared && !status.conflict && (
              <span className="font-mono text-xs text-text-muted">
                ↑{status.ahead ?? 0} ↓{status.behind ?? 0}
              </span>
            )}
          </button>
          <Popover
            align="right"
            trigger={({ open, onClick }) => (
              <button
                type="button"
                aria-label={open ? "Hide worktree details" : "Show worktree details"}
                aria-expanded={open}
                onClick={onClick}
                className="h-full border-l border-pane-border px-2 text-base leading-none text-text-secondary hover:bg-pane-title hover:text-text-primary"
              >
                ⋯
              </button>
            )}
          >
            {() => (
              <div className="w-80 space-y-2 px-3 py-2 text-xs" data-testid="worktree-details">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-muted">{summary}</div>
                {status.is_shared && (
                  <div className="text-text-muted">
                    Shares the worktree owned by top-level task ({status.top_level_task_id}).
                  </div>
                )}
                {status.path && (
                  <div className="break-all font-mono text-text-primary">{status.path}</div>
                )}
                {status.conflict && (
                  <div className="text-text-muted">
                    Resolve and commit the conflict in this worktree. The primary checkout and work item state stay unchanged.
                  </div>
                )}
                {canManage && renderDiscard()}
              </div>
            )}
          </Popover>
        </span>
      )}
      {error ? <span className="text-xs text-lifecycle-danger">{error}</span> : null}
      {trustError ? (
        <button
          type="button"
          disabled={trustBusy}
          onClick={retryTrust}
          className="border border-pane-border px-2 py-0.5 text-xs text-text-primary disabled:opacity-50"
        >
          Retry trust
        </button>
      ) : null}
    </div>
  );
}
