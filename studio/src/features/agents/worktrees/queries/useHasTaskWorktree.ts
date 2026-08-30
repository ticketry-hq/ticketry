import { useQuery } from "@apollo/client/react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { WorktreeStatusDocument } from "../generated/worktreeStatus.documents";

export type TaskWorktreeAvailability = "unknown" | "worktree" | "none";

/** Owns the live WorktreeStatus read used by selected-ticket tab lifecycle. */
export function useTaskWorktreeAvailability(
  taskId: string | null,
): TaskWorktreeAvailability {
  const query = useQuery(WorktreeStatusDocument, {
    client: studioApolloClient(),
    variables: { taskId: taskId ?? "" },
    skip: taskId === null,
  });
  const kind = query.data?.worktree_status?.kind;
  if (kind === "worktree") return "worktree";
  if (kind === "none" || kind === "no_repo" || taskId === null) return "none";
  return "unknown";
}

/** Controls the persistent Changes tab from the selected Work Item's live status. */
export function useHasTaskWorktree(taskId: string | null): boolean {
  return useTaskWorktreeAvailability(taskId) === "worktree";
}
