import { pullRequestStateLabel, type PullRequestStatusValue } from "./PullRequestStatus";

export function ChangesStateChips({ dirty, unpushedCount, pullRequest }: {
  dirty: boolean;
  unpushedCount: number;
  pullRequest?: PullRequestStatusValue | null;
}) {
  const local = [dirty ? "uncommitted" : null, unpushedCount > 0 ? `${unpushedCount} unpushed` : null].filter(Boolean);
  const pr = pullRequest && pullRequest.state !== "none" ? pullRequestStateLabel(pullRequest.state) : null;
  return (
    <>
      <span aria-label="Working tree state" className="shrink-0 border border-pane-border px-2 py-1 font-mono text-xs text-text-secondary">
        {local.length ? local.join(" · ") : "clean"}
      </span>
      {pr ? <span aria-label="Pull request state" className="shrink-0 border border-pane-border px-2 py-1 font-mono text-xs text-text-secondary">{pr}</span> : null}
    </>
  );
}
