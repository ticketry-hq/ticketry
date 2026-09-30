import { pullRequestStateLabel, type PullRequestStatusValue } from "./PullRequestStatus";

function toneClass(tone: "danger" | "attention" | "muted"): string {
  if (tone === "danger") return "bg-lifecycle-danger";
  if (tone === "attention") return "bg-lifecycle-attention";
  return "bg-text-muted";
}

/**
 * Branch state as two chips, replacing four differently-styled status boxes.
 *
 * One branch has one state, so it reads once: what the working tree holds, and
 * where its pull request stands. The long explanation each chip summarises
 * stays available in the branch inspector rather than on the review surface.
 */
export function ChangesStateChips({
  dirty,
  unpushedCount,
  pullRequest,
}: {
  dirty: boolean;
  unpushedCount: number;
  pullRequest?: PullRequestStatusValue | null;
}) {
  const local: string[] = [];
  if (dirty) local.push("uncommitted");
  if (unpushedCount > 0) local.push(`${unpushedCount} unpushed`);
  const pullRequestState = pullRequest && pullRequest.state !== "none"
    ? pullRequestStateLabel(pullRequest.state)
    : null;
  return (
    <>
      <span
        aria-label="Working tree state"
        className="flex shrink-0 items-center gap-2 border border-pane-border px-2 py-1 font-mono text-xs text-text-secondary"
      >
        <span aria-hidden="true" className={`size-2 ${toneClass(local.length > 0 ? "attention" : "muted")}`} />
        {local.length > 0 ? local.join(" · ") : "clean"}
      </span>
      {pullRequestState ? (
        <span
          aria-label="Pull request state"
          title={pullRequest?.reason ?? undefined}
          className="flex shrink-0 items-center gap-2 border border-pane-border px-2 py-1 font-mono text-xs text-text-secondary"
        >
          <span aria-hidden="true" className={`size-2 ${toneClass(pullRequest?.state === "ready" || pullRequest?.state === "merged" ? "muted" : "danger")}`} />
          {pullRequestState}
        </span>
      ) : null}
    </>
  );
}
