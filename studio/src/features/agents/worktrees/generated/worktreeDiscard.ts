// Generated from operations/worktreeDiscard.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { WorktreeStatusPayload } from "./worktreeStatus";

/**
 * The caller submits two identities and nothing else: the Work Item whose
 * checkout is being thrown away, and a stable identity for this intent. There
 * is no path, branch, repository, or force argument to give, so nothing a
 * client sends can widen what a discard removes.
 *
 * Reusing the operation identity — a double-click, a retried transport —
 * replays the durable result rather than discarding again.
 */
export interface WorktreeDiscardVariables {
  readonly taskId: string;
  readonly operationId: string;
}

/**
 * `removed: false` is an ordinary answer: the Work Item had no checkout to
 * throw away. `status` is the authoritative worktree status afterwards, so
 * the window that confirmed does not have to refetch to be correct.
 */
export interface WorktreeDiscardPayload {
  readonly removed: boolean;
  readonly task_id: string;
  readonly top_level_task_id: string;
  readonly branch: string | null;
  readonly reason: string | null;
  readonly status: WorktreeStatusPayload;
}
export interface WorktreeDiscardMutation {
  readonly worktree_discard: WorktreeDiscardPayload;
}

const source = "mutation WorktreeDiscard($taskId: String!, $operationId: String!) {\n  worktree_discard(task_id: $taskId, operation_id: $operationId) {\n    removed\n    task_id\n    top_level_task_id\n    branch\n    reason\n    status {\n      kind\n      task_id\n      top_level_task_id\n      is_shared\n      branch\n      base_branch\n      path\n      state\n      clean\n      dirty\n      ahead\n      behind\n      conflict\n      checkout_present\n      ephemeral\n      reason\n    }\n  }\n}";
export const WorktreeDiscardDocument: TypedDocumentNode<
  WorktreeDiscardMutation, WorktreeDiscardVariables
> = { kind: "Document", operationName: "WorktreeDiscard", source };
