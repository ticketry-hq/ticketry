import { useCallback, useSyncExternalStore } from "react";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { toast } from "../../state/clientStore";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  UpdateWorkTrackerWorkspaceTabOrderDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../work-items";
import {
  workspaceTabOrderFromJson,
  type WorkspaceTabIdentity,
  type WorkspaceTabOrder,
} from "./types";
import { workspaceTabIdentityKey } from "./ordering";

const saveQueues = new Map<string, Promise<WorkspaceTabOrder>>();
const pendingCounts = new Map<string, number>();
const pendingListeners = new Map<string, Set<() => void>>();

function notifyPending(workItemId: string): void {
  for (const listener of pendingListeners.get(workItemId) ?? []) listener();
}

function changePending(workItemId: string, delta: number): void {
  const next = Math.max(0, (pendingCounts.get(workItemId) ?? 0) + delta);
  if (next === 0) pendingCounts.delete(workItemId);
  else pendingCounts.set(workItemId, next);
  notifyPending(workItemId);
}

export function isWorkspaceTabOrderSavePending(workItemId: string): boolean {
  return (pendingCounts.get(workItemId) ?? 0) > 0;
}

function subscribePending(workItemId: string, listener: () => void): () => void {
  const listeners = pendingListeners.get(workItemId) ?? new Set();
  listeners.add(listener);
  pendingListeners.set(workItemId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) pendingListeners.delete(workItemId);
  };
}

function cachedIssue(
  workItemId: string,
): GeneratedWorkTrackerWorkItemFieldsFragment | undefined {
  return studioApolloClient().readFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: {
      __typename: "WorktrackerIssue",
      id: compactWorktrackerId(workItemId),
    },
    optimistic: true,
  }) ?? undefined;
}

async function executeSave(
  workItemId: string,
  order: readonly WorkspaceTabIdentity[],
): Promise<WorkspaceTabOrder> {
  const client = studioApolloClient();
  const current = cachedIssue(workItemId);
  if (!current) {
    throw new Error(`Cannot save workspace tabs before ${workItemId} is loaded.`);
  }
  const nextOrder = [...order];
  const result = await client.mutate({
    mutation: UpdateWorkTrackerWorkspaceTabOrderDocument,
    variables: {
      id: compactWorktrackerId(workItemId),
      workspaceTabOrder: nextOrder,
    },
    optimisticResponse: {
      update_work_item: {
        ...current,
        workspace_tab_order: nextOrder,
      },
    },
  });
  if (!result.data) throw new Error("Workspace tab update returned no data.");
  return workspaceTabOrderFromJson(
    result.data.update_work_item.workspace_tab_order,
  );
}

function enqueueWorkspaceTabOrder(
  workItemId: string,
  resolveOrder: () => readonly WorkspaceTabIdentity[] | null,
): Promise<WorkspaceTabOrder> {
  changePending(workItemId, 1);
  const previous = saveQueues.get(workItemId) ?? Promise.resolve({ order: [] });
  const request = previous
    .catch(() => ({ order: [] }))
    .then(() => {
      const order = resolveOrder();
      if (order) return executeSave(workItemId, order);
      const current = cachedIssue(workItemId);
      if (!current) {
        throw new Error(`Cannot read workspace tabs for ${workItemId}.`);
      }
      return workspaceTabOrderFromJson(current.workspace_tab_order);
    });
  saveQueues.set(workItemId, request);
  const clean = () => {
    changePending(workItemId, -1);
    if (saveQueues.get(workItemId) === request) saveQueues.delete(workItemId);
  };
  void request.then(clean, clean);
  return request;
}

/** Serialize all writes for one WorkItem while allowing unrelated tabs to save. */
export function saveWorkspaceTabOrder(
  workItemId: string,
  order: readonly WorkspaceTabIdentity[],
): Promise<WorkspaceTabOrder> {
  return enqueueWorkspaceTabOrder(workItemId, () => order);
}

/** Merge lifecycle additions when their queued write executes so they cannot undo a reorder. */
export function appendWorkspaceTabs(
  workItemId: string,
  identities: readonly WorkspaceTabIdentity[],
): Promise<WorkspaceTabOrder> {
  return enqueueWorkspaceTabOrder(workItemId, () => {
    const current = cachedIssue(workItemId);
    if (!current) {
      throw new Error(`Cannot append workspace tabs before ${workItemId} is loaded.`);
    }
    const order = workspaceTabOrderFromJson(current.workspace_tab_order).order;
    const known = new Set(order.map(workspaceTabIdentityKey));
    const appended = identities.filter((identity) => {
      const key = workspaceTabIdentityKey(identity);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    return appended.length > 0 ? [...order, ...appended] : null;
  });
}

function useSavePending(workItemId: string | null): boolean {
  return useSyncExternalStore(
    useCallback(
      (listener) => workItemId ? subscribePending(workItemId, listener) : () => undefined,
      [workItemId],
    ),
    useCallback(
      () => workItemId ? isWorkspaceTabOrderSavePending(workItemId) : false,
      [workItemId],
    ),
    () => false,
  );
}

export function useReorderWorkspaceTabs(workItemId: string | null) {
  const isPending = useSavePending(workItemId);
  const reorder = useCallback((order: readonly WorkspaceTabIdentity[]) => {
    if (
      workItemId === null ||
      isPending ||
      isWorkspaceTabOrderSavePending(workItemId)
    ) {
      return false;
    }
    void saveWorkspaceTabOrder(workItemId, order).catch((cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      toast.error(`Workspace tabs could not be reordered: ${message}`);
    });
    return true;
  }, [isPending, workItemId]);

  return { reorder, isPending };
}
