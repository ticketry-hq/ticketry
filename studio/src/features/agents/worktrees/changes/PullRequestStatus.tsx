export interface PullRequestStatusValue {
  url?: string | null;
  state: string;
  target_branch?: string | null;
  post_merge_work: boolean;
  replacement_eligible: boolean;
  follow_up_eligible: boolean;
  merge_preparation_eligible: boolean;
  reason?: string | null;
}

const labels: Record<string, string> = {
  ready: "Ready to merge",
  merge_conflict: "Merge conflicts",
  checks_failed: "Required checks failed",
  checks_pending: "Required checks pending",
  approval_required: "Human approval required",
  mergeability_pending: "Mergeability pending",
  wrong_base: "Wrong target branch",
  merged: "Merged",
  closed_unmerged: "Closed without merge",
  unavailable: "Pull request status unavailable",
};

export function PullRequestStatus({ status }: { status?: PullRequestStatusValue | null }) {
  if (!status || status.state === "none") return null;
  const label = labels[status.state] ?? "Pull request status unavailable";
  const detail = status.state === "wrong_base" && status.target_branch
    ? `Targets ${status.target_branch}, not the recorded base.`
    : status.post_merge_work
      ? "New branch work exists after the merged pull request."
      : status.reason;
  return (
    <div
      aria-label="Pull request status"
      className="mt-2 border border-pane-border bg-pane-title/30 px-2 py-1.5 text-xs text-text-primary"
    >
      <span className="font-medium">{label}</span>
      {detail ? <span className="ml-2 text-text-muted">{detail}</span> : null}
      {status.merge_preparation_eligible ? (
        <span className="ml-2 text-lifecycle-attention">Merge preparation available.</span>
      ) : null}
    </div>
  );
}
