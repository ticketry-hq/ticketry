import {
  commitAndPushModuleChanges,
  commitAndPushWorktreeChanges,
  commitModuleChanges,
  commitPushAndOpenModulePullRequest,
  commitPushAndOpenPullRequest,
  commitWorktreeChanges,
  openModulePullRequest,
  openPullRequest,
} from "../api";
import type {
  CheckoutRef,
  CommitOutcome,
  CommitPushOutcome,
  PullRequestOutcome,
  WorktreeCheckoutRef,
} from "../types";

/**
 * The one place a checkout identity becomes a write request.
 *
 * The reads have the same seam in `checkoutReads`, and for the same reason:
 * every action dispatches on one `CheckoutRef`, so a checkout kind cannot be
 * added with an action left silently pointed at the other kind's endpoint.
 * Each function below is the whole difference between the two kinds — above
 * this line the mutations, the footer, and the confirmation are one surface.
 */
export function writeCommit(checkout: CheckoutRef): Promise<CommitOutcome> {
  return checkout.kind === "module"
    ? commitModuleChanges(checkout.moduleId)
    : commitWorktreeChanges(checkout.taskId, worktreeContext(checkout));
}

export function writeCommitAndPush(
  checkout: CheckoutRef,
): Promise<CommitPushOutcome> {
  return checkout.kind === "module"
    ? commitAndPushModuleChanges(checkout.moduleId)
    : commitAndPushWorktreeChanges(checkout.taskId, worktreeContext(checkout));
}

export function writeCommitPushAndPullRequest(
  checkout: CheckoutRef,
): Promise<PullRequestOutcome> {
  return checkout.kind === "module"
    ? commitPushAndOpenModulePullRequest(checkout.moduleId)
    : commitPushAndOpenPullRequest(checkout.taskId, worktreeContext(checkout));
}

export function writePullRequestOnly(
  checkout: CheckoutRef,
): Promise<PullRequestOutcome> {
  return checkout.kind === "module"
    ? openModulePullRequest(checkout.moduleId)
    : openPullRequest(checkout.taskId, worktreeContext(checkout));
}

function worktreeContext(checkout: WorktreeCheckoutRef) {
  return { parentId: checkout.parentId, moduleId: checkout.moduleId };
}
