import type {
  PullRequestVerdict,
  WorktreeCheckoutRef,
} from "../types";
import { MergedWorktreeCleanup } from "./MergedWorktreeCleanup";

/** Terminal provider state for the exact pull request stored by a ship record. */
export function PullRequestVerdictBanner({
  verdict,
  checkout,
  uncommittedFileCount,
  unpushedCommitCount,
}: {
  verdict: PullRequestVerdict | null | undefined;
  checkout: WorktreeCheckoutRef | null;
  uncommittedFileCount: number;
  unpushedCommitCount: number;
}) {
  if (!verdict || verdict.state === "OPEN") return null;

  const reference = verdict.number ? `PR #${verdict.number}` : "PR";
  const sentence = `${reference} merged — clean up worktree?`;

  if (verdict.state === "MERGED" && checkout) {
    return (
      <div
        data-testid="pull-request-verdict"
        role="status"
        className="flex shrink-0 items-start gap-3 border-b border-lifecycle-success/40 bg-lifecycle-success/10 px-3 py-2 text-xs text-lifecycle-success"
      >
        <a
          href={verdict.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 underline underline-offset-2 hover:text-text-primary"
        >
          {sentence}
        </a>
        <MergedWorktreeCleanup
          checkout={checkout}
          uncommittedFileCount={uncommittedFileCount}
          unpushedCommitCount={unpushedCommitCount}
        />
      </div>
    );
  }

  const closedReference = verdict.number
    ? `Pull request #${verdict.number}`
    : "Pull request";

  return (
    <div
      data-testid="pull-request-verdict"
      role="status"
      className="shrink-0 border-b border-pane-border bg-pane-title px-3 py-2 text-xs text-text-secondary"
    >
      <a
        href={verdict.url}
        target="_blank"
        rel="noreferrer"
        aria-label={closedReference}
        className="underline underline-offset-2 hover:text-text-primary"
      >
        {closedReference} was closed without merging.
      </a>
    </div>
  );
}
