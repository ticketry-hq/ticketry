import { WorktreeSwitcher } from "./WorktreeSwitcher";
import { ChangesStateChips } from "./ChangesStateChips";
import { toggleBranchInspector, useBranchInspector } from "./branchInspectorState";
import type { ChangesActionsController } from "./useChangesActions";

/**
 * The single row of chrome above the review surface.
 *
 * It answers three questions and nothing else: which checkout am I reading,
 * what state is it in, and what should I do next. Every other command moved
 * into the branch inspector this row toggles.
 */
export function ChangesToolbar({
  actions,
  moduleId,
  selectedTaskId,
  onOpenModule,
  onOpenTask,
}: {
  actions: ChangesActionsController;
  moduleId?: string | null;
  selectedTaskId: string | null;
  onOpenModule: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const inspectorOpen = useBranchInspector((state) => state.open);
  const { commands, primary, busy } = actions;
  const pending = busy !== null;

  return (
    <div
      aria-label="Changes commands"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-pane-border px-3"
    >
      <WorktreeSwitcher
        moduleId={moduleId}
        selectedTaskId={selectedTaskId}
        onOpenModule={onOpenModule}
        onOpenTask={onOpenTask}
      />
      <ChangesStateChips
        dirty={commands.dirty}
        unpushedCount={commands.unpushedCount}
        pullRequest={commands.pullRequest}
      />
      <span className="flex-1" />
      <div className="relative">
        <button
          type="button"
          aria-label={`${primary.label} on ${commands.branch ?? "the current branch"}`}
          disabled={primary.kind === "none" || pending}
          title={primary.disabledReason ?? undefined}
          onClick={() => actions.runPrimary()}
          className="border border-text-primary bg-text-primary px-2.5 py-1 font-medium text-pane-bg disabled:opacity-50"
        >
          {busy === "stack" || busy === "push" || busy === "pull-request"
            ? "Running..."
            : primary.label}
        </button>
        {actions.confirmingStack ? (
          <div
            role="dialog"
            aria-label="Confirm Changes action"
            className="absolute right-0 z-50 mt-1 w-72 border border-pane-border bg-pane-panel p-2 shadow-2xl"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              actions.setConfirmingStack(false);
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) actions.setConfirmingStack(false);
            }}
          >
            <p className="text-xs text-text-muted">
              {primary.label} on {commands.branch ?? "the current branch"} will publish{" "}
              {commands.unpushedCount + (commands.dirty ? 1 : 0)} commit
              {commands.unpushedCount + (commands.dirty ? 1 : 0) === 1 ? "" : "s"}.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => void actions.runStack()}
                className="border border-text-primary bg-text-primary px-2 py-1 font-medium text-pane-bg"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => actions.setConfirmingStack(false)}
                className="border border-pane-border px-2 py-1 text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {commands.pullRequestUrl ? (
        <a
          href={commands.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 border border-pane-border px-2 py-1 text-text-primary"
        >
          Open PR
        </a>
      ) : null}
      <button
        type="button"
        aria-pressed={inspectorOpen}
        aria-controls="changes-branch-inspector"
        onClick={() => toggleBranchInspector()}
        className={`shrink-0 border px-2 py-1 ${inspectorOpen ? "border-focus-accent text-focus-accent" : "border-pane-border text-text-primary"}`}
      >
        Branch
      </button>
    </div>
  );
}
