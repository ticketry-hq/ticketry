/**
 * Batched WorkItem convergence.
 *
 * A single write can publish several facts (an archive cascades, a reparent
 * repairs descendants), so identities are collected in a short window and
 * invalidated once. Two rules make the batch safe:
 *
 * - The canonical entity is always refreshed; its containing collection only
 *   when a fact actually claimed a membership change.
 * - An identity with an in-flight local mutation is left alone. That
 *   mutation's own settle invalidation is authoritative, and refetching while
 *   its optimistic value is visible would paint an older external value over
 *   the person's edit.
 */
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";

export const WORK_ITEM_INVALIDATION_WINDOW_MS = 50;

export interface WorkItemInvalidator {
  /** Queue one fact. `membershipChanged` also refreshes the collection. */
  record(workItemId: string, membershipChanged: boolean): void;
  /**
   * Queue a removal. A deleted identity is evicted rather than invalidated —
   * refetching it would only ask the server to confirm it is gone — and its
   * containing collection is always refreshed.
   */
  recordRemoval(workItemId: string): void;
  /** Apply everything queued now, ignoring the window. */
  flush(): void;
  /** Drop everything queued; used when the feed stops or switches project. */
  cancel(): void;
}

export function createWorkItemInvalidator(
  windowMs: number = WORK_ITEM_INVALIDATION_WINDOW_MS,
): WorkItemInvalidator {
  const pending = new Set<string>();
  const removed = new Set<string>();
  let membershipChanged = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const ids = [...pending];
    const evicted = [...removed];
    pending.clear();
    removed.clear();
    const refreshMembership = membershipChanged;
    membershipChanged = false;
    for (const id of evicted) {
      queryClient.removeQueries({
        queryKey: queryKeys.workItems.byId(id),
        exact: true,
      });
    }
    for (const id of ids) {
      const locallyMutating = queryClient.isMutating({
        predicate: (mutation) =>
          (mutation.state.variables as { id?: unknown } | undefined)?.id === id,
      });
      if (locallyMutating > 0) continue;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workItems.byId(id),
        exact: true,
      });
    }
    if (refreshMembership) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    }
  };

  return {
    record(workItemId, changed) {
      pending.add(workItemId);
      membershipChanged ||= changed;
      timer ??= setTimeout(flush, windowMs);
    },
    recordRemoval(workItemId) {
      removed.add(workItemId);
      pending.delete(workItemId);
      membershipChanged = true;
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      removed.clear();
      membershipChanged = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
