// Generated from operations/worktreeStatus.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

/**
 * Discriminated on `kind`:
 *   "worktree" — a live checkout; every Git fact below is populated,
 *   "no_repo"  — nothing could enclose this Work Item (`reason` set),
 *   "none"     — a repository exists but no checkout does yet.
 */
export interface WorktreeStatusPayload {
  readonly kind: "worktree" | "no_repo" | "none";
  readonly task_id: string;
  readonly top_level_task_id: string;
  readonly is_shared: boolean;
  readonly branch: string | null;
  readonly base_branch: string | null;
  readonly path: string | null;
  readonly state: string | null;
  readonly clean: boolean | null;
  readonly dirty: boolean | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly conflict: boolean | null;
  readonly checkout_present: boolean | null;
  readonly ephemeral: boolean;
  readonly reason: string | null;
}

export interface WorktreeStatusVariables {
  readonly taskId: string;
}
export interface WorktreeStatusQuery {
  readonly worktree_status: WorktreeStatusPayload;
}

const source = "query WorktreeStatus($taskId: String!) {\n  worktree_status(task_id: $taskId) {\n    kind\n    task_id\n    top_level_task_id\n    is_shared\n    branch\n    base_branch\n    path\n    state\n    clean\n    dirty\n    ahead\n    behind\n    conflict\n    checkout_present\n    ephemeral\n    reason\n  }\n}";
export const WorktreeStatusDocument: TypedDocumentNode<
  WorktreeStatusQuery, WorktreeStatusVariables
> = { kind: "Document", operationName: "WorktreeStatus", source };
