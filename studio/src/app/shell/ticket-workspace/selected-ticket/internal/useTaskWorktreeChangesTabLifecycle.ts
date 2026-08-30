import { useEffect } from "react";

import { useTaskWorktreeAvailability } from "../../../../../features/agents/worktrees";
import { WorktreeChangesDocument } from "../../../../../features/agents/worktrees/generated/worktreeChanges.documents";
import type { ForegroundOwner } from "../../../../../features/agents/terminal";
import { studioApolloClient } from "../../../../../shared/apollo/client";
import { useClientStore } from "../../../../../state/clientStore";
import { rememberStudioWorkspaceTarget } from "./studioWorkspaceTarget";

export function useTaskWorktreeChangesTabLifecycle({
  taskId,
  owner,
}: {
  taskId: string | null;
  owner: ForegroundOwner;
}): boolean {
  const availability = useTaskWorktreeAvailability(taskId);
  const setActive = useClientStore((state) => state.setActive);

  useEffect(() => {
    if (!taskId || availability !== "worktree") return;
    void studioApolloClient().query({
      query: WorktreeChangesDocument,
      variables: { taskId },
      fetchPolicy: "network-only",
    }).catch(() => undefined);
  }, [availability, taskId]);

  useEffect(() => {
    if (
      !taskId ||
      availability !== "none" ||
      useClientStore.getState().workspaces[taskId]?.active !== "changes"
    ) {
      return;
    }

    setActive(taskId, "details");
    if (owner === "studio") {
      rememberStudioWorkspaceTarget(taskId, { kind: "details" });
    }
  }, [availability, owner, setActive, taskId]);

  return availability === "worktree";
}
