import type { ReactNode } from "react";

interface IssueToolbarProps {
  /** Run, worktree, type and workflow controls, leading the row. */
  actions: ReactNode;
  /** Location and identity (the breadcrumb), trailing the row. */
  location: ReactNode;
  menu: ReactNode;
}

/** Keeps workflow controls visible while the issue document scrolls. */
export function IssueToolbar({ actions, location, menu }: IssueToolbarProps) {
  return (
    <div className="issue-toolbar flex-none border-b border-pane-border bg-pane-panel">
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2"
        data-testid="status-row"
      >
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="details-actions"
        >
          {actions}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {location}
          {menu}
        </div>
      </div>
    </div>
  );
}
