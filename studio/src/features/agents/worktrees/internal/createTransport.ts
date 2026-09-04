/**
 * Where opting into a worktree goes.
 *
 * On the desktop the authority is the in-process Rust runtime: it derives the
 * owning Work Item, the module's configured repository, the committed HEAD,
 * the base, the branch, and the checkout path itself, so the request carries
 * one Work Item identity and one operation identity and nothing the client
 * could get wrong. That is production: the legacy host route was retired at the
 * Slice 4 handoff and refuses. What remains below it is the browser-only
 * development path, which has no in-process runtime to ask.
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

/** A stable identity for one user intent, reused across its retries. */
export function newOperationId(): string {
  return crypto.randomUUID();
}

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
