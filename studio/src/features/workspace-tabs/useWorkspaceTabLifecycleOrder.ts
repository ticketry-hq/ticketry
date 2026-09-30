import { useEffect, useRef } from "react";
import { appendWorkspaceTabs } from "./mutations";
import { workspaceTabIdentityKey } from "./ordering";
import type { WorkspaceTabIdentity } from "./types";

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
  const savedKey = savedOrder.map(workspaceTabIdentityKey).join("\n");
  const visibleIdentitiesRef = useRef(visibleIdentities);
  const lastAttemptRef = useRef<string | null>(null);
  visibleIdentitiesRef.current = visibleIdentities;

  useEffect(() => {
    if (!workItemId || !orderReady) return;
    const known = new Set(savedOrder.map(workspaceTabIdentityKey));
    const appended = visibleIdentitiesRef.current.filter((identity) => {
      const key = workspaceTabIdentityKey(identity);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (appended.length === 0) return;
    const attemptKey = `${workItemId}\0${savedKey}\0${visibleKey}`;
    if (lastAttemptRef.current === attemptKey) return;
    lastAttemptRef.current = attemptKey;
    void appendWorkspaceTabs(workItemId, appended).catch(() => undefined);
  }, [orderReady, savedKey, savedOrder, visibleKey, workItemId]);
}
