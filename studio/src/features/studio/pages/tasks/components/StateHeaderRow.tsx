import React from "react";

interface StateHeaderRowProps {
  stateName: string;
  count: number;
  isCollapsed: boolean;
  // Name-taking handler so the parent can pass one stable callback to every
  // header without defeating React.memo.
  onToggle: (stateName: string) => void;
}

export const StateHeaderRow = React.memo(function StateHeaderRow({
  stateName,
  count,
  isCollapsed,
  onToggle,
}: StateHeaderRowProps) {
  return (
    <li
      role="button"
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? `Expand ${stateName}` : `Collapse ${stateName}`}
      onClick={() => onToggle(stateName)}
      className="flex cursor-pointer select-none items-center px-1 pt-2 pb-0.5 text-text-primary hover:bg-pane-title [content-visibility:auto] [contain-intrinsic-size:auto_2rem]"
    >
      <span className="mr-1 inline-block w-4 shrink-0 text-center text-text-muted">
        {isCollapsed ? "▸" : "▾"}
      </span>
      <span className="font-bold">{stateName}</span>
      <span className="ml-2 text-text-muted">{count}</span>
    </li>
  );
});
