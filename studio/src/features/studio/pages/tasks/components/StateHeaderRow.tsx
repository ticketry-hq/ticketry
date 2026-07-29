import React from "react";
import type { DropTargetProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";

interface StateHeaderRowProps {
  stateName: string;
  count: number;
  isCollapsed: boolean;
  // Name-taking handler so the parent can pass one stable callback to every
  // header without defeating React.memo.
  onToggle: (stateName: string) => void;
  dropTargetProps?: DropTargetProps;
  showDropSeam?: boolean;
}

export const StateHeaderRow = React.memo(function StateHeaderRow({
  stateName,
  count,
  isCollapsed,
  onToggle,
  dropTargetProps,
  showDropSeam = false,
}: StateHeaderRowProps) {
  return (
    <li
      role="button"
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? `Expand ${stateName}` : `Collapse ${stateName}`}
      onClick={() => onToggle(stateName)}
      {...dropTargetProps}
      className="relative flex cursor-pointer select-none items-center px-1 pt-2 pb-0.5 text-text-primary hover:bg-pane-title"
    >
      {showDropSeam ? (
        <span
          data-testid="ticket-drop-seam"
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-0.5 bg-focus-accent"
        />
      ) : null}
      <span className="mr-1 inline-block w-4 shrink-0 text-center text-text-muted">
        {isCollapsed ? "▸" : "▾"}
      </span>
      <span className="font-bold">{stateName}</span>
      <span className="ml-2 text-text-muted">{count}</span>
    </li>
  );
});
