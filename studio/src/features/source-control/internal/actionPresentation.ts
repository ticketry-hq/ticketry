import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type {
  ActionStepName,
  CheckoutKind,
  CommitOutcome,
  CommitPushOutcome,
  PullRequestOutcome,
} from "../types";
import { checkoutNoun } from "./checkoutCopy";

/** What each step is called while a reviewer watches it run. */
const STEP_LABELS: Record<ActionStepName, string> = {
  stage: "Collect changes",
  generate_message: "Write commit message",
  commit: "Commit (hooks run)",
  push: "Push to remote",
  pull_request: "Create pull request",
};

export function stepLabel(name: ActionStepName): string {
  return STEP_LABELS[name] ?? name;
}

/** The one-line result a reviewer reads after the commit-only action settles. */
export function outcomeSummary(
  kind: CheckoutKind,
  outcome: CommitOutcome,
): string {
  if (outcome.status === "nothing_to_commit") {
    return `Nothing to commit — this ${checkoutNoun(kind)} matches its last commit.`;
  }
  return `Committed ${shortSha(outcome.commit_sha)} · ${fileCount(
    outcome.file_count,
  )} · ${outcome.subject}`;
}

/**
 * The one-line result after the commit-and-push action settles.
 *
 * Each status gets its own sentence rather than one sentence with clauses
 * switched on and off: `push_failed` in particular has to say that the commit
 * survived, because that is the part a user would otherwise assume was lost.
 */
export function commitPushSummary(
  kind: CheckoutKind,
  outcome: CommitPushOutcome,
): string {
  const target = `${outcome.remote}/${outcome.branch}`;
  switch (outcome.status) {
    case "committed_and_pushed":
      return `Committed ${shortSha(outcome.commit_sha)} and pushed to ${target} · ${fileCount(
        outcome.file_count,
      )} · ${outcome.subject}`;
    case "pushed":
      return `Nothing to commit — pushed this branch's existing commits to ${target}.`;
    case "up_to_date":
      return `Nothing to do — ${target} already has this branch's last commit.`;
    case "push_failed":
      return outcome.commit_sha
        ? `Committed ${shortSha(outcome.commit_sha)}, but nothing was pushed. The commit is safe in this ${checkoutNoun(kind)}.`
        : "Nothing was pushed.";
  }
}

/**
 * The one-line result after the pull-request action settles.
 *
 * Each status gets its own sentence rather than one sentence with clauses
 * switched on and off. The two failures are the reason: both leave real work
 * behind — a commit, or a commit and a published branch — and a user who is not
 * told that will assume it was lost.
 */
export function pullRequestSummary(
  kind: CheckoutKind,
  outcome: PullRequestOutcome,
): string {
  const target = `${outcome.remote}/${outcome.branch}`;
  switch (outcome.status) {
    case "opened":
      return `Opened a pull request into ${outcome.base_branch} · ${outcome.pull_request_title}`;
    case "already_open":
      return `${outcome.branch} already had an open pull request into ${outcome.base_branch}.`;
    case "push_failed":
      return outcome.commit_sha
        ? `Committed ${shortSha(outcome.commit_sha)}, but nothing was pushed, so no pull request was opened. The commit is safe in this ${checkoutNoun(kind)}.`
        : "Nothing was pushed, so no pull request was opened.";
    case "pull_request_failed":
      return `Pushed to ${target}, but GitHub would not open the pull request. The branch is published.`;
  }
}

function shortSha(sha: string | null): string {
  return (sha ?? "").slice(0, 7);
}

function fileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/**
 * The captured hook output a refused commit carries, if it carried any.
 *
 * This is the one place raw command output is shown on purpose: a hook is the
 * repository's own policy, and its complaint is the only thing that tells the
 * reviewer what to fix. A refused *push* carries none — a remote's words name
 * URLs and echo whatever the server chose to say, so the backend curates that
 * into a sentence instead.
 */
export function hookOutput(error: unknown): string | null {
  if (!(error instanceof WorkTrackerApiError)) return null;
  const body = error.body;
  if (!body || typeof body !== "object") return null;
  const output = (body as { hook_output?: unknown }).hook_output;
  return typeof output === "string" && output.trim() ? output : null;
}

/** The sentence to show when the action itself failed. */
export function actionFailureMessage(error: unknown): string {
  if (error instanceof WorkTrackerApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Studio could not run this action on the checkout.";
}
