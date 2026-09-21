import { useEffect, useRef, type ReactNode } from "react";

import { InspectorSection } from "./InspectorSection";
import { PullRequestStatus } from "./PullRequestStatus";
import { toggleBranchInspector, useBranchInspector } from "./branchInspectorState";
import { canReceiveRestoredFocus } from "./confirmationFocus";
import type { ChangesActionsController } from "./useChangesActions";

export function BranchInspector({ actions, branch, baseline, lastCommit, localMerge, worktree }: {
  actions: ChangesActionsController;
  branch?: string | null;
  baseline?: string | null;
  lastCommit?: string | null;
  localMerge?: ReactNode;
  worktree?: ReactNode;
}) {
  const open = useBranchInspector((state) => state.open);
  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ownsFocusRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!open) return;
    const inspector = rootRef.current;
    const workspace = inspector?.closest<HTMLElement>('[data-testid="changes-workspace-scroll"]')
      ?? null;
    const frame = requestAnimationFrame(() => {
      if (canReceiveRestoredFocus(closeRef.current)) {
        closeRef.current.focus({ preventScroll: true });
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (ownsFocusRef.current || inspector?.contains(document.activeElement)) {
        const branch = workspace?.querySelector<HTMLButtonElement>(
          '[aria-controls="changes-branch-inspector"]',
        ) ?? null;
        if (canReceiveRestoredFocus(branch)) {
          branch.focus({ preventScroll: true });
        }
      }
    };
  }, [open]);
  if (!open) return null;
  const { commands, busy } = actions;
  const pending = busy !== null;
  const pullRequest = commands.pullRequest;
  const local = [commands.dirty ? "uncommitted" : null, commands.unpushedCount > 0 ? `${commands.unpushedCount} unpushed` : null].filter(Boolean);
  return (
    <aside
      ref={rootRef}
      id="changes-branch-inspector"
      aria-label="Branch inspector"
      data-testid="changes-branch-inspector"
      className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-pane-border bg-pane-panel"
      onFocusCapture={() => { ownsFocusRef.current = true; }}
      onBlurCapture={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          ownsFocusRef.current = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        toggleBranchInspector(false);
      }}
    >
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-pane-border px-3">
        <h2 className="text-xs uppercase tracking-wide text-text-secondary">Branch</h2>
        <button ref={closeRef} type="button" aria-label="Close branch inspector" onClick={() => toggleBranchInspector(false)} className="text-xs text-text-muted hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent">Close</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InspectorSection section="status" title="Status" chip={local.length ? "dirty" : "clean"}>
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 font-mono text-xs">
            <dt className="text-text-muted">branch</dt><dd className="break-all text-text-primary">{branch ?? "Unavailable"}</dd>
            {baseline ? <><dt className="text-text-muted">baseline</dt><dd className="break-all text-text-primary">{baseline}</dd></> : null}
            <dt className="text-text-muted">ahead</dt><dd className="text-text-primary">{commands.unpushedCount} commits</dd>
            <dt className="text-text-muted">working</dt><dd className="text-text-primary">{commands.dirty ? "uncommitted changes" : "clean"}</dd>
            {lastCommit ? <><dt className="text-text-muted">last commit</dt><dd className="break-all text-text-primary">{lastCommit}</dd></> : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!commands.dirty || pending} onClick={() => void actions.commit()} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-focus-accent">{busy === "commit" ? "Committing..." : "Commit"}</button>
            <button type="button" disabled={commands.unpushedCount <= 0 || pending} onClick={() => void actions.push()} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-focus-accent">{busy === "push" ? "Pushing..." : "Push"}</button>
          </div>
          {commands.commitDescription ? <p role="status" className="text-xs text-text-muted">{commands.commitDescription}</p> : null}
          {commands.dirty && (commands.unpushedCount > 0 || commands.pullRequestCreationEligible) ? (
            <p role="status" className="text-xs text-lifecycle-attention">
              Push sends committed work only. Uncommitted changes stay local.
              {commands.pullRequestCreationEligible ? " Create PR follows the same rule." : ""}
            </p>
          ) : null}
        </InspectorSection>
        <InspectorSection section="pull-request" title="Pull request" chip={pullRequest?.state ?? (commands.pullRequestUrl ? "open" : "none")}>
          <PullRequestStatus status={pullRequest} />
          <div className="flex flex-wrap gap-2">
            {!commands.pullRequestUrl && commands.pullRequestCreationEligible && commands.onCreatePullRequest ? <button type="button" disabled={pending} onClick={() => void actions.createPullRequest(commands.onCreatePullRequest)} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50">Create PR</button> : null}
            {pullRequest?.replacement_eligible && commands.onReplacePullRequest ? <button type="button" disabled={pending} onClick={() => void actions.createPullRequest(commands.onReplacePullRequest)} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50">Replace PR</button> : null}
            {pullRequest?.follow_up_eligible && commands.onFollowUpPullRequest ? <button type="button" disabled={pending} onClick={() => void actions.createPullRequest(commands.onFollowUpPullRequest)} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50">Create follow-up PR</button> : null}
            {pullRequest?.merge_preparation_eligible && commands.onPrepareMerge ? <button type="button" disabled={pending} onClick={() => void actions.prepareMerge()} className="border border-pane-border px-2 py-1 text-text-primary disabled:opacity-50">Prepare merge</button> : null}
          </div>
        </InspectorSection>
        {localMerge ? <InspectorSection section="local-merge" title="Local merge">{localMerge}</InspectorSection> : null}
        {worktree ? <InspectorSection section="worktree" title="Worktree">{worktree}</InspectorSection> : null}
      </div>
    </aside>
  );
}
