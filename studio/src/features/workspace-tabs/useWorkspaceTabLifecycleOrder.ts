import { useEffect, useRef } from "react";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { saveWorkspaceTabOrder } from "./mutations";
import { workspaceTabIdentityKey } from "./ordering";
import type { WorkspaceTabIdentity, WorkspaceTabOrder } from "./types";

/** Append newly durable tabs without removing remembered dormant identities. */
export function useWorkspaceTabLifecycleOrder({
  workItemId,
  savedOrder,
  orderReady,
  visibleIdentities,
}: {
  workItemId: string | null;
  savedOrder: readonly WorkspaceTabIdentity[];
  orderReady: boolean;
  visibleIdentities: readonly WorkspaceTabIdentity[];
}): void {
  const visibleKey = visibleIdentities.map(workspaceTabIdentityKey).join("\n");
  const visibleIdentitiesRef = useRef(visibleIdentities);
  visibleIdentitiesRef.current = visibleIdentities;

  useEffect(() => {
    if (!workItemId || !orderReady) return;
    const queryKey = queryKeys.workspaceTabs.byWorkItem(workItemId);
    const cached = queryClient.getQueryData<WorkspaceTabOrder>(queryKey);
    const currentOrder = cached?.order ?? savedOrder;
    const known = new Set(currentOrder.map(workspaceTabIdentityKey));
    const appended = visibleIdentitiesRef.current.filter((identity) => {
      const key = workspaceTabIdentityKey(identity);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (appended.length === 0) return;

    const nextOrder = [...currentOrder, ...appended];
    queryClient.setQueryData<WorkspaceTabOrder>(queryKey, { order: nextOrder });
    void saveWorkspaceTabOrder(workItemId, nextOrder).then(
      (saved) => {
        const latest = queryClient.getQueryData<WorkspaceTabOrder>(queryKey);
        if (latest?.order === nextOrder) {
          queryClient.setQueryData(queryKey, saved);
        }
      },
      () => queryClient.invalidateQueries({ queryKey }),
    );
  }, [orderReady, savedOrder, visibleKey, workItemId]);
}
