import React from "react";
import type { DropTargetProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import {
  IconCheckCircle,
  IconGrill,
  IconImplement,
  IconList,
  IconReview,
  IconSpec,
  IconTickets,
  IconX,
  type IconProps,
} from "../../../../../shared/ui/icons";

interface StateHeaderRowProps {
  stateName: string;
  stateColor: string;
  count: number;
  isCollapsed: boolean;
  // Name-taking handler so the parent can pass one stable callback to every
  // header without defeating React.memo.
  onToggle: (stateName: string) => void;
  dropTargetProps?: DropTargetProps;
  showDropSeam?: boolean;
}

const STAGE_ICON_BY_NAME: Readonly<
  Record<string, React.ComponentType<IconProps>>
> = {
  Grill: IconGrill,
  Spec: IconSpec,
  Tickets: IconTickets,
  Implement: IconImplement,
  Review: IconReview,
  Done: IconCheckCircle,
  Cancelled: IconX,
};

export function stageIconForName(
  stateName: string,
): React.ComponentType<IconProps> {
  return STAGE_ICON_BY_NAME[stateName] ?? IconList;
}

export const StateHeaderRow = React.memo(function StateHeaderRow({
  stateName,
  stateColor,
  count,
  isCollapsed,
  onToggle,
  dropTargetProps,
  showDropSeam = false,
}: StateHeaderRowProps) {
  const StageIcon = stageIconForName(stateName);

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
      <span
        data-stage-icon={stateName}
        aria-hidden="true"
        className="mr-1 inline-flex w-4 shrink-0 items-center justify-center"
        style={{ color: stateColor }}
      >
        <StageIcon />
      </span>
      <span className="font-bold">{stateName}</span>
      <span className="ml-2 text-text-muted">{count}</span>
    </li>
  );
});
