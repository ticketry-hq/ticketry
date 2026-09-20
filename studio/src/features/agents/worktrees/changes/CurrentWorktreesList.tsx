import { useQuery } from "@apollo/client/react";
import { memo } from "react";

import { studioApolloClient } from "../../../../shared/apollo/client";
import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { CurrentWorktreesDocument } from "../generated/currentWorktrees.documents";

export const CurrentWorktreesList = memo(function CurrentWorktreesList({
  moduleId,
  selectedTaskId,
  onOpenModule,
  onOpenTask,
}: {
  moduleId?: string | null;
  selectedTaskId: string | null;
  onOpenModule: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const query = useQuery(CurrentWorktreesDocument, {
    client: studioApolloClient(),
    variables: { moduleId: compactWorktrackerId(moduleId ?? "") },
    skip: !moduleId,
    fetchPolicy: "cache-first",
  });
  if (!moduleId) return <p className="p-3 text-text-muted">Worktree checkouts unavailable.</p>;
  const nodes = (query.data ?? query.previousData)?.worktrees.nodes;
  const rows = [
    { taskId: null, label: "Module checkout", branch: null },
    ...(nodes ?? []).slice(0, 100).map((row) => ({
      taskId: row.taskId,
      label: row.issue
        ? `${row.project?.slug ?? "Work Item"}-${row.issue.sequenceId} ${row.issue.name}`
        : row.branch,
      branch: row.branch,
    })),
  ];
  return (
    <section aria-label="Current worktrees" className="h-full min-h-0 overflow-auto p-3">
      <header className="mb-2">
        <h2 className="font-medium text-text-primary">Current worktrees</h2>
        <p className="text-xs text-text-muted">Module checkout first, then active task worktrees.</p>
      </header>
      <ul className="space-y-1" aria-label="Current worktree checkouts">
        {rows.map((row) => {
          const selected = row.taskId === null
            ? selectedTaskId === null
            : compactWorktrackerId(row.taskId) === compactWorktrackerId(selectedTaskId ?? "");
          return (
            <li key={row.taskId ?? "module"}>
              <button
                type="button"
                onClick={() => row.taskId === null ? onOpenModule() : onOpenTask(row.taskId)}
                className={`w-full border px-2.5 py-2 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent ${selected ? "border-focus-accent bg-pane-title" : "border-pane-border"}`}
                aria-label={`Open ${row.label} Changes`}
                aria-pressed={selected}
              >
                <span className="block truncate font-medium text-text-primary">{row.label}</span>
                {row.branch ? <span className="mt-1 block truncate font-mono text-xs text-text-muted">{row.branch}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {query.error ? <p role="alert" className="mt-2 text-lifecycle-danger">Unable to load worktree checkouts.</p>
        : !nodes ? <p role="status" className="mt-2 text-text-muted">Loading worktree checkouts...</p>
          : nodes.length === 0 ? <p className="mt-2 text-xs text-text-muted">No current task worktrees.</p> : null}
      {nodes && nodes.length > 100 ? <p role="status" className="mt-2 text-xs text-lifecycle-attention">The current-worktree limit was reached.</p> : null}
    </section>
  );
});
