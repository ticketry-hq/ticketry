import { useEffect } from "react";

import { useTaskWorktreeAvailability } from "../../agents/worktrees";
import type { ForegroundOwner } from "../../agents/terminal";
import { useClientStore } from "../../../state/clientStore";
import { rememberStudioWorkspaceTarget } from "../../workspace-state/studioWorkspaceTarget";

export function useTaskWorktreeChangesTabLifecycle({
  taskId,
  owner,
  hasSelectedChangesCheckout = false,
}: {
  taskId: string | null;
  owner: ForegroundOwner;
  hasSelectedChangesCheckout?: boolean;
}): boolean {
  const availability = useTaskWorktreeAvailability(taskId);
  const setActive = useClientStore((state) => state.setActive);

  useEffect(() => {
    if (
      !taskId ||
      hasSelectedChangesCheckout ||
      availability !== "none" ||
      useClientStore.getState().workspaces[taskId]?.active !== "changes"
    ) {
      return;
    }

    setActive(taskId, "details");
    if (owner === "studio") {
      rememberStudioWorkspaceTarget(taskId, { kind: "details" });
    }
  }, [availability, hasSelectedChangesCheckout, owner, setActive, taskId]);

  return hasSelectedChangesCheckout || availability === "worktree";
}
