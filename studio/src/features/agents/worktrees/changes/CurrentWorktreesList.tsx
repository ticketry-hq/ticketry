interface CurrentWorktree {
  kind: string;
  task_id?: string | null;
  task_key?: string | null;
  task_name?: string | null;
  branch?: string | null;
  available: boolean;
  clean?: boolean | null;
  dirty?: boolean | null;
  unpushed_count?: number | null;
  pull_request_state: string;
  pull_request?: {
    state: string;
    reason?: string | null;
    post_merge_work: boolean;
  } | null;
  reason?: string | null;
}

function checkoutState(row: CurrentWorktree): string {
  if (!row.available) return "Unavailable";
  return row.dirty ? "Dirty" : "Clean";
}

function pullRequestState(state: string): string {
  switch (state) {
    case "none":
      return "No pull request";
    case "open":
      return "Pull request open";
    case "ready":
      return "Ready to merge";
    case "merge_conflict":
      return "Merge conflicts";
    case "checks_failed":
      return "Required checks failed";
    case "checks_pending":
      return "Required checks pending";
    case "approval_required":
      return "Human approval required";
    case "mergeability_pending":
      return "Mergeability pending";
    case "wrong_base":
      return "Wrong target branch";
    case "merged":
      return "Pull request merged";
    case "closed":
    case "closed_unmerged":
      return "Pull request closed";
    case "unavailable":
      return "Pull request unavailable";
    default:
      return "Pull request status unavailable";
  }
}

export function CurrentWorktreesList({
  rows,
  truncated,
  onOpenModule,
  onOpenTask,
}: {
  rows: readonly CurrentWorktree[];
  truncated: boolean;
  onOpenModule: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const taskCount = rows.filter((row) => row.kind === "task").length;
  return (
    <section aria-label="Current worktrees" className="min-h-0 overflow-auto p-3">
      <header className="mb-2">
        <h2 className="font-medium text-text-primary">Current worktrees</h2>
        <p className="text-xs text-text-muted">Module checkout first, then active task worktrees.</p>
      </header>
      <ul className="space-y-1" aria-label="Current worktree checkouts">
        {rows.map((row) => {
          const label = row.kind === "module"
            ? "Module checkout"
            : `${row.task_key ?? "Work Item"} ${row.task_name ?? ""}`.trim();
          const state = checkoutState(row);
          const unpushed = row.unpushed_count ?? 0;
          return (
            <li key={row.kind === "module" ? "module" : row.task_id ?? label}>
              <button
                type="button"
                onClick={() => row.kind === "module"
                  ? onOpenModule()
                  : row.task_id && onOpenTask(row.task_id)}
                className="w-full border border-pane-border px-2.5 py-2 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
                aria-label={`Open ${label} Changes`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                    {label}
                  </span>
                  <span className={row.available && row.dirty
                    ? "text-xs text-lifecycle-attention"
                    : row.available
                      ? "text-xs text-lifecycle-success"
                      : "text-xs text-lifecycle-danger"}
                  >
                    {state}
                  </span>
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-text-muted">
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {row.branch ?? "Branch unavailable"}
                  </span>
                  <span>{unpushed} unpushed</span>
                  <span>
                    {pullRequestState(row.pull_request_state)}
                    {row.pull_request?.post_merge_work ? ", new branch work" : ""}
                  </span>
                </span>
                {!row.available && row.reason ? (
                  <span className="mt-1 block text-xs text-lifecycle-danger">{row.reason}</span>
                ) : null}
                {row.pull_request_state === "unavailable" && row.pull_request?.reason ? (
                  <span className="mt-1 block text-xs text-lifecycle-danger">
                    {row.pull_request.reason}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {taskCount === 0 ? (
        <p className="mt-2 text-xs text-text-muted">No current task worktrees.</p>
      ) : null}
      {truncated ? (
        <p className="mt-2 text-xs text-lifecycle-attention" role="status">
          The current-worktree limit was reached.
        </p>
      ) : null}
    </section>
  );
}
