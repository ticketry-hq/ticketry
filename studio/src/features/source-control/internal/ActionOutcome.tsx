import type { StackedAction } from "./useStackedAction";

/**
 * What a settled action leaves on screen: a result, and the next thing to do.
 *
 * Three things can be true at once and each is shown on its own terms — the
 * one-line result, the created pull request, and a curated failure with the
 * hook output that explains it. They are separate rather than one status line
 * because a run that committed, pushed, and then had GitHub refuse has both a
 * result worth keeping and a failure worth acting on.
 *
 * `View pull request` exists even though the action already opened the browser:
 * the open is a side effect that can be swallowed by a pop-up blocker or a
 * machine with no default browser, and a URL the user cannot reach is
 * indistinguishable from a pull request that was never created.
 */
export function ActionOutcome({
  action,
  onViewPullRequest,
}: {
  action: StackedAction;
  onViewPullRequest: () => void;
}) {
  return (
    <>
      {action.summary && (
        <p
          data-testid="action-outcome"
          role="status"
          className="mt-2 text-xs text-text-secondary"
        >
          {action.summary}
        </p>
      )}

      {(action.pullRequestUrl || action.canRetryPullRequest) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {action.pullRequestUrl && (
            <button
              type="button"
              data-testid="view-pull-request"
              onClick={onViewPullRequest}
              className="border border-pane-border px-2 py-1 text-xs text-text-primary hover:bg-pane-title"
            >
              View pull request
            </button>
          )}
          {action.pullRequestUrl && (
            <span
              data-testid="pull-request-url"
              className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted"
            >
              {action.pullRequestUrl}
            </span>
          )}
          {action.canRetryPullRequest && (
            <button
              type="button"
              data-testid="retry-pull-request"
              onClick={() => action.run("pull_request")}
              disabled={action.running}
              className="border border-pane-border px-2 py-1 text-xs text-text-primary hover:bg-pane-title disabled:opacity-50"
            >
              {action.isRunning("pull_request")
                ? "Creating pull request…"
                : "Create pull request"}
            </button>
          )}
        </div>
      )}

      {action.failure && (
        <div className="mt-2">
          <p
            data-testid="action-failure"
            role="alert"
            className="text-xs text-lifecycle-danger"
          >
            {action.failure}
          </p>
          {action.hookOutput && (
            <pre
              data-testid="action-hook-output"
              className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border border-pane-border px-2 py-1 font-mono text-xs text-text-secondary"
            >
              {action.hookOutput}
            </pre>
          )}
        </div>
      )}
    </>
  );
}
