import Popover from "../../../../shared/ui/Popover";
import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { checkoutToneClass } from "./worktreeCheckoutRows";
import { useWorktreeCheckouts } from "./useWorktreeCheckouts";

/**
 * Pick which checkout the Changes surface is reviewing.
 *
 * This replaced a permanent column that only ever repeated the tab strip. As a
 * switcher it costs one row of the toolbar, and it can afford to carry the
 * state each checkout is in, which the column never did.
 */
export function WorktreeSwitcher({
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
  const { rows, loading, failed, truncated } = useWorktreeCheckouts(moduleId);
  const isSelected = (taskId: string | null) => taskId === null
    ? selectedTaskId === null
    : compactWorktrackerId(taskId) === compactWorktrackerId(selectedTaskId ?? "");
  const current = rows.find((row) => isSelected(row.taskId));
  const taskRows = rows.filter((row) => row.taskId !== null);

  return (
    <Popover data-testid="changes-worktree-switcher" trigger={({ open, onClick }) => (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Change worktree checkout"
        className="flex min-w-0 max-w-[26rem] items-center gap-2 border border-pane-border px-2 py-1 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent"
      >
        {current ? <span aria-hidden="true" className={`size-2 shrink-0 ${checkoutToneClass(current.tone)}`} /> : null}
        <span className="truncate font-medium text-text-primary">
          {current?.label ?? (moduleId ? "Loading checkouts..." : "Worktree checkouts unavailable")}
        </span>
        {current?.branch ? (
          <span className="truncate font-mono text-xs text-text-muted">{current.branch}</span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 text-text-muted">▾</span>
      </button>
    )}>
      {(close) => (
        <section aria-label="Worktree checkouts" className="min-w-[22rem]">
          <header className="px-3 py-1.5">
            <h2 className="text-xs uppercase tracking-wide text-text-secondary">Current worktrees</h2>
            <p className="text-xs text-text-muted">Module checkout first, then active task worktrees.</p>
          </header>
          <ul aria-label="Current worktree checkouts" className="max-h-[22rem] overflow-y-auto">
            {rows.map((row) => {
              const selected = isSelected(row.taskId);
              return (
                <li key={row.taskId ?? "module"}>
                  <button
                    type="button"
                    aria-label={`Open ${row.label} Changes`}
                    aria-pressed={selected}
                    onClick={() => {
                      close();
                      if (row.taskId === null) onOpenModule();
                      else onOpenTask(row.taskId);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-pane-title focus-visible:ring-1 focus-visible:ring-focus-accent ${selected ? "bg-pane-title shadow-[inset_2px_0_0_0_theme(colors.focus.accent)]" : ""}`}
                  >
                    <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 ${checkoutToneClass(row.tone)}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-text-primary">{row.label}</span>
                      {row.branch ? (
                        <span className="block truncate font-mono text-xs text-text-muted">{row.branch}</span>
                      ) : null}
                    </span>
                    {row.summary ? (
                      <span className="shrink-0 font-mono text-xs text-text-secondary">{row.summary}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {failed ? <p role="alert" className="px-3 py-2 text-xs text-lifecycle-danger">Unable to load worktree checkouts.</p>
            : loading ? <p role="status" className="px-3 py-2 text-xs text-text-muted">Loading worktree checkouts...</p>
              : taskRows.length === 0 ? <p className="px-3 py-2 text-xs text-text-muted">No current task worktrees.</p> : null}
          {truncated ? <p role="status" className="px-3 py-2 text-xs text-lifecycle-attention">The current-worktree limit was reached.</p> : null}
        </section>
      )}
    </Popover>
  );
}
