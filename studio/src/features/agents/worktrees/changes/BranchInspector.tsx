import { type ReactNode } from "react";

import { InspectorSection } from "./InspectorSection";
import { PullRequestStatus } from "./PullRequestStatus";
import { toggleBranchInspector, useBranchInspector } from "./branchInspectorState";
import type { ChangesActionsController } from "./useChangesActions";

/**
 * Branch state and every command that is not the toolbar's primary action.
 *
 * Review and shipping are two different jobs on one screen. Files and diff keep
 * the window; this panel holds the shipping detail and collapses away when a
 * reader only wants to read. It renders no animation, matching the rest of the
 * terminal surface.
 */
export function BranchInspector({
  actions,
  branch,
  baseline,
  lastCommit,
  localMerge,
  worktree,
}: {
  actions: ChangesActionsController;
  branch?: string | null;
  baseline?: string | null;
  lastCommit?: string | null;
  localMerge?: ReactNode;
  worktree?: ReactNode;
}) {
  const open = useBranchInspector((state) => state.open);
  if (!open) return null;
  const { commands, busy } = actions;
  const pending = busy !== null;
  const pullRequest = commands.pullRequest;
  const local: string[] = [];
  if (commands.dirty) local.push("uncommitted");
  if (commands.unpushedCount > 0) local.push(`${commands.unpushedCount} unpushed`);

  return (
    <aside
      id="changes-branch-inspector"
      aria-label="Branch inspector"
      data-testid="changes-branch-inspector"
      className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-pane-border bg-pane-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        toggleBranchInspector(false);
      }}
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-pane-border px-3">
        <h2 className="text-xs uppercase tracking-wide text-text-secondary">Branch</h2>
        <button
          type="button"
          aria-label="Close branch inspector"
          onClick={() => toggleBranchInspector(false)}
          className="text-xs text-text-muted hover:text-text-primary"
        >
          Close
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorSection
          section="status"
          title="Status"
          chip={local.length > 0 ? "dirty" : "clean"}
          chipTone={local.length > 0 ? "attention" : "muted"}
        >
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 font-mono text-xs">
            <dt className="text-text-muted">branch</dt>
            <dd className="break-all text-text-primary">{branch ?? "Unavailable"}</dd>
            {baseline ? (
              <>
                <dt className="text-text-muted">baseline</dt>
                <dd className="break-all text-text-primary">{baseline}</dd>
              </>
            ) : null}
            <dt className="text-text-muted">ahead</dt>
            <dd className="text-text-primary">{commands.unpushedCount} commits</dd>
            <dt className="text-text-muted">working</dt>
            <dd className="text-text-primary">{commands.dirty ? "uncommitted changes" : "clean"}</dd>
            {lastCommit ? (
              <>
                <dt className="text-text-muted">last commit</dt>
                <dd className="break-all text-text-primary">{lastCommit}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!commands.dirty || pending}
              onClick={() => void actions.commit()}
              className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
            >
              {busy === "commit" ? "Committing..." : "Commit"}
            </button>
            <button
              type="button"
              disabled={commands.unpushedCount <= 0 || pending}
              title={commands.unpushedCount <= 0 ? "Nothing to push." : undefined}
              onClick={() => void actions.push()}
              className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
            >
              {busy === "push" ? "Pushing..." : "Push"}
            </button>
          </div>
          {commands.commitDescription ? (
            <p role="status" className="text-xs text-text-muted">{commands.commitDescription}</p>
          ) : null}
          {commands.dirty && (commands.unpushedCount > 0 || commands.pullRequestCreationEligible) ? (
            <p role="status" className="text-xs text-lifecycle-attention">
              Push sends committed work only. Uncommitted changes stay local.
              {commands.pullRequestCreationEligible ? " Create PR follows the same rule." : ""}
            </p>
          ) : null}
        </InspectorSection>

        <InspectorSection
          section="pull-request"
          title="Pull request"
          chip={pullRequestChip(pullRequest?.state, commands.pullRequestUrl)}
          chipTone={pullRequestTone(pullRequest?.state)}
        >
          <PullRequestStatus status={pullRequest} />
          <div className="flex flex-wrap gap-2">
            {!commands.pullRequestUrl
              && commands.pullRequestCreationEligible
              && commands.onCreatePullRequest ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void actions.createPullRequest(commands.onCreatePullRequest)}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                {busy === "pull-request" ? "Creating PR..." : "Create PR"}
              </button>
            ) : null}
            {pullRequest?.replacement_eligible && commands.onReplacePullRequest ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void actions.createPullRequest(commands.onReplacePullRequest)}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                {busy === "pull-request" ? "Replacing PR..." : "Replace PR"}
              </button>
            ) : null}
            {pullRequest?.follow_up_eligible && commands.onFollowUpPullRequest ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void actions.createPullRequest(commands.onFollowUpPullRequest)}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                {busy === "pull-request" ? "Creating follow-up..." : "Create follow-up PR"}
              </button>
            ) : null}
            {pullRequest?.merge_preparation_eligible && commands.onPrepareMerge ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void actions.prepareMerge()}
                className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50"
              >
                {busy === "merge-preparation" ? "Starting merge preparation..." : "Prepare merge"}
              </button>
            ) : null}
          </div>
        </InspectorSection>

        {localMerge ? (
          <InspectorSection section="local-merge" title="Local merge">
            {localMerge}
          </InspectorSection>
        ) : null}

        {worktree ? (
          <InspectorSection section="worktree" title="Worktree">
            {worktree}
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  );
}

function pullRequestChip(state?: string | null, url?: string | null): string | null {
  if (!state || state === "none") return url ? "open" : "none";
  if (state === "ready") return "ready";
  if (state === "merge_conflict") return "conflicts";
  if (state === "merged") return "merged";
  return state.replace(/_/g, " ");
}

function pullRequestTone(state?: string | null): "danger" | "attention" | "success" | "muted" {
  if (state === "ready" || state === "merged") return "success";
  if (state === "merge_conflict" || state === "checks_failed" || state === "wrong_base") return "danger";
  if (!state || state === "none") return "muted";
  return "attention";
}
