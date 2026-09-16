import { useState } from "react";

import { PullRequestStatus, type PullRequestStatusValue } from "./PullRequestStatus";

type ActionStep = {
  name: "stage" | "generate_message" | "commit" | "push" | "pull_request";
  status: "ok" | "skipped" | "failed";
};

type ActionOutcome = {
  steps: ActionStep[];
  error?: string;
};

export function ChangesActions({
  dirty,
  unpushedCount,
  onCommit,
  commitDescription,
  onPush,
  pullRequestUrl,
  pullRequestCreationEligible,
  onCreatePullRequest,
  pullRequest,
  onReplacePullRequest,
  onFollowUpPullRequest,
  onPrepareMerge,
  onStack,
  stackKind,
  branch,
}: {
  dirty: boolean;
  unpushedCount: number;
  onCommit: () => Promise<void>;
  commitDescription?: string | null;
  onPush: () => Promise<void>;
  pullRequestUrl?: string | null;
  pullRequestCreationEligible?: boolean;
  onCreatePullRequest?: () => Promise<{ url: string }>;
  pullRequest?: PullRequestStatusValue | null;
  onReplacePullRequest?: () => Promise<{ url: string }>;
  onFollowUpPullRequest?: () => Promise<{ url: string }>;
  onPrepareMerge?: () => Promise<void>;
  onStack?: () => Promise<{ head_commit?: string; subject?: string; message_source?: string }>;
  stackKind?: "task" | "module";
  branch?: string | null;
}) {
  const [busy, setBusy] = useState<
    "commit" | "push" | "pull-request" | "merge-preparation" | "stack" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingStack, setConfirmingStack] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const commit = async () => {
    setBusy("commit");
    setError(null);
    setNotice(null);
    try {
      await onCommit();
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

  const runStack = async () => {
    setBusy("stack");
    setError(null);
    setNotice(null);
    setOutcome(null);
    setConfirmingStack(false);
    const steps: ActionStep[] = [];
    const run = async (name: ActionStep["name"], action: () => Promise<void>) => {
      try {
        await action();
        steps.push({ name, status: "ok" });
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : `${name} failed.`;
        steps.push({ name, status: "failed" });
        setOutcome({ steps: [...steps], error: message });
        return false;
      }
    };
    steps.push({ name: "stage", status: "skipped" });
    steps.push({ name: "generate_message", status: "skipped" });
    if (!onStack) {
      setOutcome({ steps, error: "Stacked action is unavailable." });
      setBusy(null);
      return;
    }
    if (!(await run("commit", async () => { await onStack(); }))) {
      setBusy(null);
      return;
    }
    steps.push({ name: "push", status: "ok" });
    steps.push({ name: "pull_request", status: "skipped" });
    setOutcome({ steps });
    setBusy(null);
  };

  const stackLabel = stackKind === "task" && pullRequestCreationEligible
    ? "Commit, push & create PR"
    : "Commit & push";

  return (
    <div className="mt-3 space-y-2" aria-label="Changes commands">
      <div className="flex flex-wrap items-center gap-2">
        {stackKind ? (
          <button
            type="button"
            disabled={(!dirty && unpushedCount <= 0) || busy !== null}
            onClick={() => setConfirmingStack(true)}
            className="border border-pane-border bg-text-primary px-2 py-1 text-pane-bg disabled:opacity-50"
          >
            {busy === "stack" ? "Running..." : stackLabel}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!dirty || busy !== null}
          onClick={() => void commit()}
          className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {busy === "commit" ? "Committing..." : "Commit"}
        </button>
        {commitDescription ? (
          <span className="text-xs text-text-muted" role="status">
            {commitDescription}
          </span>
        ) : null}
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
      {confirmingStack ? (
        <div className="border border-pane-border p-2" role="dialog" aria-label="Confirm Changes action">
          <p className="text-xs text-text-muted">
            {stackLabel} on {branch ?? "the current branch"} will publish {unpushedCount + (dirty ? 1 : 0)} commit{unpushedCount + (dirty ? 1 : 0) === 1 ? "" : "s"}.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void runStack()} className="border border-pane-border px-2 py-1 text-text-primary">
              Confirm
            </button>
            <button type="button" onClick={() => setConfirmingStack(false)} className="border border-pane-border px-2 py-1 text-text-primary">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {outcome ? (
        <div className="border border-pane-border p-2 text-xs" role="status" aria-label="Changes action outcome">
          <div className="font-medium text-text-primary">{outcome.error ? "Action partially completed" : "Action complete"}</div>
          <ol className="mt-1 space-y-1">
            {outcome.steps.map((step) => (
              <li key={step.name}>{step.name.replace("_", " ")}: {step.status}</li>
            ))}
          </ol>
          {outcome.error ? <div className="mt-1 text-lifecycle-danger">{outcome.error}</div> : null}
        </div>
      ) : null}
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
