/**
 * Converging exactly the worktree holding a fact describes.
 *
 * One top-level Work Item owns one checkout, so a `worktree.changed` or
 * `worktree.deleted` fact names one owner and exactly one holding has to be
 * re-read. Invalidating the whole `["worktrees", "status"]` prefix would work,
 * and would also refetch every other task's worktree a person has open — each
 * of which costs a real `git status` in the Rust runtime. Publishing the owner
 * in the fact exists precisely so that does not have to happen.
 *
 * A holding is matched two ways, because a child view shares its parent's
 * checkout and may have been keyed before the owner was known:
 *
 *   - by key, for every view that already derived this owner, and
 *   - by the owner the cached status itself reports, which is authoritative and
 *     covers a view keyed under an intermediate ancestor.
 *
 * Facts are batched for the same reason WorkItem and document facts are: a
 * create followed by a reconciliation publishes several in a row about the same
 * checkout, and each would otherwise cost its own live Git read.
 *
 * A removal is invalidated rather than evicted. The cache entry is the *status
 * of a Work Item*, which still exists and still has an answer — `none` — after
 * the checkout is gone. Evicting it would blank the block instead of showing
 * that answer.
 */
import { studioApolloClient } from "../../../../shared/apollo/client";
import {
  WorktreeStatusDocument,
  type WorktreeStatusQuery,
} from "../../worktrees/generated/worktreeStatus.documents";

export const WORKTREE_INVALIDATION_WINDOW_MS = 50;

export interface WorktreeInvalidator {
  /** Queue one owner. Repeats inside the window cost one refetch. */
  record(topLevelTaskId: string): void;
  /** Apply everything queued now, ignoring the window. */
  flush(): void;
  /** Drop everything queued; used when the feed stops or switches project. */
  cancel(): void;
}

export function createWorktreeInvalidator(
  windowMs: number = WORKTREE_INVALIDATION_WINDOW_MS,
): WorktreeInvalidator {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const owners = [...pending];
    pending.clear();
    for (const owner of owners) {
      void studioApolloClient().refetchQueries({
        include: "active",
        onQueryUpdated(observableQuery) {
          if (observableQuery.queryName !== "WorktreeStatus") return false;
          const variables = observableQuery.variables as { taskId?: unknown };
          const data = observableQuery.getCurrentResult().data as
            | WorktreeStatusQuery
            | undefined;
          const matches = variables.taskId === owner
            || data?.worktree_status.top_level_task_id === owner;
          return matches ? observableQuery.refetch() : false;
        },
      });
    }
  };

  return {
    record(topLevelTaskId) {
      pending.add(topLevelTaskId);
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Re-read every visible worktree holding.
 *
 * Used at the boundaries where no individual fact can be trusted to have been
 * seen — a reconnect that replayed from a retained cursor, and a cursor reset —
 * because live Git state can have moved while the stream was gone without any
 * fact this client received saying so.
 */
export function refreshWorktreeHoldings(): Promise<void> {
  return studioApolloClient()
    .refetchQueries({ include: [WorktreeStatusDocument] })
    .then(() => undefined);
}
