/**
 * How the worktree block's status payload becomes Studio's own shape.
 *
 * The status query itself is issued by `WorktreeBlock` through Apollo, sending
 * one Work Item identity and nothing else: the in-process Rust runtime derives
 * the owning Work Item, the module's configured folder, the repository, and
 * the live Git facts itself. This module owns only the adaptation of that
 * answer.
 */
import type { WorktreeStatusQuery } from "../generated/worktreeStatus.documents";
import type { WorktreeStatus } from "./types";

export type WorktreeStatusPayload = WorktreeStatusQuery["worktree_status"];

/**
 * The discriminated contract, field by field. Absence stays absent: a `none`
 * or `no_repo` answer carries no invented branch, path, or count, and a
 * `worktree` answer carries exactly what Git reported.
 */
export function adaptWorktreeStatus(
  payload: WorktreeStatusPayload,
): WorktreeStatus {
  return {
    kind: payload.kind as WorktreeStatus["kind"],
    task_id: payload.task_id,
    top_level_task_id: payload.top_level_task_id,
    is_shared: payload.is_shared,
    branch: payload.branch,
    base_branch: payload.base_branch,
    path: payload.path,
    state: payload.state,
    clean: payload.clean,
    dirty: payload.dirty,
    ahead: payload.ahead,
    behind: payload.behind,
    conflict: payload.conflict,
    checkout_present: payload.checkout_present,
    ephemeral: payload.ephemeral,
    reason: payload.reason,
  };
}
