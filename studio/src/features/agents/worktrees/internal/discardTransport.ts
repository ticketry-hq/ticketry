/**
 * Where throwing a worktree away goes.
 *
 * The request carries one Work Item identity and one operation identity, and
 * nothing a client could use to widen the removal. The in-process Rust runtime
 * looks the checkout up in Ticketry's own index and removes exactly that tree
 * and that branch.
 *
 * The operation identity is what makes a repeated request safe. It is minted
 * once per confirmed discard and reused for every retry of *that* intent, so a
 * double-click or a lost response replays the same durable result instead of
 * removing something a second time.
 */
import { studioRuntime } from "../../../../runtime";
import { WorktreeDiscardDocument } from "../generated/worktreeDiscard.documents";
import {
  adaptWorktreeStatus,
  type WorktreeStatusPayload,
} from "./statusTransport";
import type { DiscardResult } from "./types";

export function requestWorktreeDiscard(
  taskId: string,
  operationId: string,
): Promise<DiscardResult> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const payload = (
        await execute(WorktreeDiscardDocument, { taskId, operationId })
      ).worktree_discard;
      return {
        removed: payload.removed,
        reason: payload.reason ?? "",
        // The mutation's own response is the authority for the window that
        // confirmed, so the block renders it without a follow-up status read.
        status: adaptWorktreeStatus(payload.status as WorktreeStatusPayload),
      };
    },
  });
}
