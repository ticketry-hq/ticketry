// Generated from operations/worktreeCreate.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { WorktreeStatusPayload } from "./worktreeStatus";

/**
 * The caller submits two identities and nothing else: the Work Item to
 * isolate, and a stable identity for this intent. Reusing the operation
 * identity — a double-click, a retried transport — returns the same worktree
 * rather than creating a second one.
 *
 * The response is the authoritative status of the checkout that now exists,
 * so the window that asked does not have to refetch to be correct.
 */
export interface WorktreeCreateVariables {
  readonly taskId: string;
  readonly operationId: string;
}
export interface WorktreeCreateMutation {
  readonly worktree_create: WorktreeStatusPayload;
}

const source = "mutation WorktreeCreate($taskId: String!, $operationId: String!) {\n  worktree_create(task_id: $taskId, operation_id: $operationId) {\n    kind\n    task_id\n    top_level_task_id\n    is_shared\n    branch\n    base_branch\n    path\n    state\n    clean\n    dirty\n    ahead\n    behind\n    conflict\n    checkout_present\n    ephemeral\n    reason\n  }\n}";
export const WorktreeCreateDocument: TypedDocumentNode<
  WorktreeCreateMutation, WorktreeCreateVariables
> = { kind: "Document", operationName: "WorktreeCreate", source };
