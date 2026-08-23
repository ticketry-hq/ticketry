/**
 * Where the worktree block's status comes from.
 *
 * On the desktop the authority is the in-process Rust runtime: it derives the
 * owning Work Item, the module's configured folder, the repository, and the
 * live Git facts itself, so the query sends one identity and nothing the
 * client could get wrong. That is production: the legacy host route was retired
 * at the Slice 4 handoff and refuses. What remains below it is the browser-only
 * development path, which has no in-process runtime to ask.
 */
import { studioRuntime } from "../../../../runtime";
import {
  WorktreeStatusDocument,
  type WorktreeStatusPayload,
} from "../generated/worktreeStatus";
import type { WorktreeContext, WorktreeStatus } from "./api";

export function readWorktreeStatus(
  taskId: string,
  ctx: WorktreeContext,
  signal?: AbortSignal,
): Promise<WorktreeStatus> {
  void ctx;
  void signal;
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) =>
      adaptWorktreeStatus(
        (await execute(WorktreeStatusDocument, { taskId })).worktree_status,
      ),
  });
}

/**
 * The discriminated contract, field by field. Absence stays absent: a `none`
 * or `no_repo` answer carries no invented branch, path, or count, and a
 * `worktree` answer carries exactly what Git reported.
 */
export function adaptWorktreeStatus(
  payload: WorktreeStatusPayload,
): WorktreeStatus {
  return {
    kind: payload.kind,
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
