import { useId, useState } from "react";

import { PullRequestStatus, type PullRequestStatusValue } from "./PullRequestStatus";

export function ChangesActions({
  dirty,
  unpushedCount,
  onCommit,
  onPush,
  pullRequestUrl,
  pullRequestCreationEligible,
  onCreatePullRequest,
  pullRequest,
  onReplacePullRequest,
  onFollowUpPullRequest,
  onPrepareMerge,
}: {
  dirty: boolean;
  unpushedCount: number;
  onCommit: (message: string) => Promise<void>;
  onPush: () => Promise<void>;
  pullRequestUrl?: string | null;
  pullRequestCreationEligible?: boolean;
  onCreatePullRequest?: () => Promise<{ url: string }>;
  pullRequest?: PullRequestStatusValue | null;
  onReplacePullRequest?: () => Promise<{ url: string }>;
  onFollowUpPullRequest?: () => Promise<{ url: string }>;
  onPrepareMerge?: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const messageId = useId();
  const [busy, setBusy] = useState<
    "commit" | "push" | "pull-request" | "merge-preparation" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commit = async () => {
    setBusy("commit");
    setError(null);
    setNotice(null);
    try {
      await onCommit(message.trim());
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commit failed.");
    } finally {
      setBusy(null);
    }
  };

  const push = async () => {
    setBusy("push");
    setError(null);
    setNotice(null);
    try {
      await onPush();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  };

  const createPullRequest = async (
    action: (() => Promise<{ url: string }>) | undefined,
  ) => {
    if (!action) return;
    setBusy("pull-request");
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pull-request creation failed.");
    } finally {
      setBusy(null);
    }
  };

  const prepareMerge = async () => {
    if (!onPrepareMerge) return;
    setBusy("merge-preparation");
    setError(null);
    setNotice(null);
    try {
      await onPrepareMerge();
      setNotice("Merge-preparation agent started.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Merge preparation failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 space-y-2" aria-label="Changes commands">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={messageId}>
          Commit message
        </label>
        <input
          id={messageId}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Commit message"
          disabled={!dirty || busy !== null}
          className="min-w-56 border border-pane-border bg-pane-bg px-2 py-1 text-text-primary disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!dirty || !message.trim() || busy !== null}
          onClick={() => void commit()}
          className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {busy === "commit" ? "Committing..." : "Commit"}
        </button>
        <button
          type="button"
          disabled={unpushedCount <= 0 || busy !== null}
          onClick={() => void push()}
          className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {busy === "push" ? "Pushing..." : "Push"}
        </button>
        {pullRequestUrl ? (
          <a
            href={pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border border-pane-border px-2 py-1 text-text-primary"
          >
            Open PR
          </a>
        ) : pullRequestCreationEligible && onCreatePullRequest ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void createPullRequest(onCreatePullRequest)}
            className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy === "pull-request" ? "Creating PR..." : "Create PR"}
          </button>
        ) : null}
        {pullRequest?.replacement_eligible && onReplacePullRequest ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void createPullRequest(onReplacePullRequest)}
            className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy === "pull-request" ? "Replacing PR..." : "Replace PR"}
          </button>
        ) : null}
        {pullRequest?.follow_up_eligible && onFollowUpPullRequest ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void createPullRequest(onFollowUpPullRequest)}
            className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy === "pull-request" ? "Creating follow-up..." : "Create follow-up PR"}
          </button>
        ) : null}
        {pullRequest?.merge_preparation_eligible && onPrepareMerge ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void prepareMerge()}
            className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy === "merge-preparation" ? "Starting merge preparation..." : "Prepare merge"}
          </button>
        ) : null}
      </div>
      <PullRequestStatus status={pullRequest} />
      {dirty && (unpushedCount > 0 || pullRequestCreationEligible) ? (
        <p className="text-xs text-lifecycle-attention" role="status">
          Push sends committed work only. Uncommitted changes stay local.
          {pullRequestCreationEligible ? " Create PR follows the same rule." : ""}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-lifecycle-danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-xs text-lifecycle-success" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
