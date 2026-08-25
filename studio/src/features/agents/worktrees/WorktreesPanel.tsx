import { studioRuntime } from "../../../runtime";
import { WorktreeDiscardControl } from "./WorktreeDiscardControl";
import {
  OpenWorktreeInFinder,
  type WorktreeRevealRuntime,
} from "./OpenWorktreeInFinder";
import { useModuleWorktrees } from "./queries";

interface WorktreesPanelProps {
  projectId: string;
  moduleId: string;
  runtime?: WorktreeRevealRuntime;
}

export function WorktreesPanel({
  projectId,
  moduleId,
  runtime = studioRuntime(),
}: WorktreesPanelProps) {
  const { worktrees, loading, failed } = useModuleWorktrees(projectId, moduleId);

  return (
    <section
      aria-label="Module worktrees"
      className="absolute bottom-full right-0 z-50 mb-1 flex max-h-[min(32rem,calc(100vh-3rem))] w-[min(30rem,calc(100vw-1rem))] flex-col border border-pane-border bg-pane-panel text-left shadow-xl"
      data-testid="module-worktrees-panel"
    >
      <div className="border-b border-pane-border px-3 py-2 text-sm font-semibold text-text-primary">
        Worktrees
      </div>
      <div className="overflow-y-auto p-2">
        {loading && worktrees.length === 0 ? (
          <div className="px-1 py-2 text-xs text-text-muted">Loading worktrees…</div>
        ) : null}
        {!loading && !failed && worktrees.length === 0 ? (
          <div className="px-1 py-2 text-xs text-text-muted">
            This module has no task worktrees.
          </div>
        ) : null}
        {failed ? (
          <div className="px-1 py-2 text-xs text-lifecycle-danger">
            Some worktree statuses could not be loaded.
          </div>
        ) : null}
        <div className="space-y-2">
          {worktrees.map(({ task, status }) => (
            <article
              key={task.id}
              className="space-y-2 border border-pane-border bg-pane-bg/50 p-2"
              data-testid={`module-worktree-${task.id}`}
            >
              <div>
                <div className="text-xs font-medium text-text-primary">
                  {task.key} · {task.name}
                </div>
                <div className="mt-0.5 break-all font-mono text-xs text-text-secondary">
                  {status.branch}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    status.dirty
                      ? "text-lifecycle-attention"
                      : "text-lifecycle-success"
                  }
                >
                  {status.dirty ? "dirty" : "clean"}
                </span>
                <span className="text-text-muted">↑{status.ahead ?? 0}</span>
                <span className="text-text-muted">↓{status.behind ?? 0}</span>
                {status.conflict ? (
                  <span className="text-lifecycle-danger">conflicted</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <OpenWorktreeInFinder path={status.path} runtime={runtime} />
                <WorktreeDiscardControl
                  status={status}
                  parentId={task.parent_id}
                  moduleId={moduleId}
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
