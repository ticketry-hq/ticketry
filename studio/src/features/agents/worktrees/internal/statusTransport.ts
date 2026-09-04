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
import { studioApolloClient } from "../../../../shared/apollo/client";
import {
  WorktreeStatusDocument,
} from "../generated/worktreeStatus.documents";
import type { WorktreeStatusQuery } from "../generated/worktreeStatus.documents";
import type { WorktreeStatus } from "./types";

export type WorktreeStatusPayload = WorktreeStatusQuery["worktree_status"];

export function readWorktreeStatus(
  taskId: string,
  signal?: AbortSignal,
): Promise<WorktreeStatus> {
  void signal;
  return studioApolloClient()
    .query({
      query: WorktreeStatusDocument,
      variables: { taskId },
      fetchPolicy: "network-only",
    })
    .then(({ data }) => {
      if (!data) throw new Error("Worktree status returned no data.");
      return adaptWorktreeStatus(
        data.worktree_status as WorktreeStatusPayload,
      );
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
