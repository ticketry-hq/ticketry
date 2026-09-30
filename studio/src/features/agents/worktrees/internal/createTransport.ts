/**
 * Where opting into a worktree goes.
 *
 * The request carries one Work Item identity and one operation identity, and
 * nothing else. The in-process Rust runtime derives the owning Work Item, the
 * module's configured repository, the committed HEAD, the base, the branch,
 * and the checkout path itself, so there is nothing here the client could get
 * wrong.
 *
 * The operation identity is what makes a repeated request safe. It is minted
 * once per user intent and reused for every retry of *that* intent, so a
 * double-click or a lost response converges on the same worktree instead of
 * cutting a second branch.
 */
import { studioRuntime } from "../../../../runtime";
import { WorktreeCreateDocument } from "../generated/worktreeCreate.documents";
import {
  adaptWorktreeStatus,
  type WorktreeStatusPayload,
} from "./statusTransport";
import type { WorktreeStatus } from "./types";
export { newOperationId } from "./operationId";

export function requestWorktreeCreate(
  taskId: string,
  operationId: string,
): Promise<WorktreeStatus> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) =>
      adaptWorktreeStatus(
        (await execute(WorktreeCreateDocument, { taskId, operationId }))
          .worktree_create as WorktreeStatusPayload,
      ),
  });
}
