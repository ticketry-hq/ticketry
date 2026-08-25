import { useMutation } from "@tanstack/react-query";
import { queryClient } from "../../shared/query/queryClient";
import { studioRuntime } from "../../runtime";
import {
  writeCommit,
  writeCommitAndPush,
  writeCommitPushAndPullRequest,
  writePullRequestOnly,
} from "./internal/checkoutWrites";
import { invalidateCheckoutChanges } from "./queries";
import type {
  CheckoutRef,
  CommitOutcome,
  CommitPushOutcome,
  PullRequestOutcome,
} from "./types";

/**
 * Commit everything the checkout changed.
 *
 * A commit rewrites the very thing the panel is showing, so a settled run —
 * success or failure — drops the cached review. Failure invalidates too: a
 * hook can leave the tree different from how it was read, and a stale list is
 * worse than a re-read.
 *
 * Both checkout kinds run the same mutation. Which one it writes is carried by
 * the `CheckoutRef`, which also decides the cache entry that gets dropped — so
 * committing in a module base checkout cannot repaint a task worktree's review
 * or the other way round.
 */
export function useCommitCheckout(checkout: CheckoutRef) {
  return useMutation<CommitOutcome, unknown, void>(
    {
      mutationFn: () => writeCommit(checkout),
      onSettled: () => invalidateCheckoutChanges(checkout),
    },
    queryClient,
  );
}

/**
 * Commit everything the checkout changed, then publish its branch.
 *
 * The mutation is the whole stack, run server-side in one ordered pass, so
 * there is no client-side sequencing here that could commit and then forget to
 * push — or push a commit the user never confirmed.
 *
 * A settled run drops the cached review and, with it, the cached confirmation:
 * the confirmation's key extends the review's, so one invalidation clears both
 * — which is what this needs, because the commit rewrote the working tree the
 * review described and the push moved the remote the confirmation counted
 * against. Failure invalidates too; the commit may still have landed.
 */
export function useCommitAndPushCheckout(checkout: CheckoutRef) {
  return useMutation<CommitPushOutcome, unknown, void>(
    {
      mutationFn: () => writeCommitAndPush(checkout),
      onSettled: () => invalidateCheckoutChanges(checkout),
    },
    queryClient,
  );
}

/**
 * Commit, push, and open the pull request — then land the user on it.
 *
 * Opening the browser is part of the mutation rather than something the footer
 * does when it renders, because it must happen once per successful run. A
 * component that opened the URL from its own render or effect would reopen the
 * tab on every repaint that still had the outcome in hand.
 *
 * The open is deliberately not awaited into the mutation's result: the pull
 * request exists whether or not this machine managed to launch a browser, and
 * failing the action over a browser that would not start would misreport what
 * happened on GitHub.
 */
export function useCommitPushAndOpenPullRequest(checkout: CheckoutRef) {
  return useMutation<PullRequestOutcome, unknown, void>(
    {
      mutationFn: () => writeCommitPushAndPullRequest(checkout),
      onSuccess: (outcome) => openPullRequestUrl(outcome.pull_request_url),
      onSettled: () => invalidateCheckoutChanges(checkout),
    },
    queryClient,
  );
}

/** Open the pull request alone, for the retry after a provider failure. */
export function useOpenPullRequest(checkout: CheckoutRef) {
  return useMutation<PullRequestOutcome, unknown, void>(
    {
      mutationFn: () => writePullRequestOnly(checkout),
      onSuccess: (outcome) => openPullRequestUrl(outcome.pull_request_url),
      onSettled: () => invalidateCheckoutChanges(checkout),
    },
    queryClient,
  );
}

/**
 * Hand a created pull request to the platform browser, if one was created.
 *
 * `null` is an ordinary outcome, not an error: a failed push means no pull
 * request was attempted, so there is nothing to open and nothing to report.
 */
export function openPullRequestUrl(url: string | null): void {
  if (!url) return;
  void studioRuntime().openExternalUrl(url);
}
