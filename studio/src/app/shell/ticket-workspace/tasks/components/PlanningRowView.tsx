import type React from "react";
import {
  AgentStateBadge,
  AutomationDeliveryChicklet,
  AutomationFailureChicklet,
} from "../../../../../features/agents/lifecycle";
import { type RunPresentationState } from "../../../../../features/agents/status";
import { LifecycleBadge } from "../../../../../features/agents/terminal";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import {
  beginTaskDetailFromClick,
  recordTaskDetailClick,
} from "../../../../../shared/utilities/taskDetailProbe";
import { WorkItemRowLabel } from "./WorkItemRowLabel";

// Warm the description-editor chunk on first row hover so it is already
// cached when a selected issue's details render. Fired at most once.
let editorWarmed = false;
const preloadDescriptionEditor = () => {
  if (editorWarmed) return;
  editorWarmed = true;
  void import("../../../../../features/documents/DescriptionEditor");
};

export interface PlanningRowViewProps {
  id: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  identifier: string;
  stateColor: string | null;
  name: string;
  isSelected: boolean;
  onClick: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  dragSourceProps?: DragSourceProps;
  descendantIds: string[];
  showAgentBadges?: boolean;
  runState?: RunPresentationState | null;
  /** Replaces the identifier + name label (conversation rows). */
  label?: React.ReactNode;
  /** Indicators after the label, before any run state. */
  trailing?: React.ReactNode;
}

export function PlanningRowView({
  id,
  depth,
  expandable,
  expanded,
  identifier,
  stateColor,
  name,
  isSelected,
  onClick,
  onToggleExpand,
  dragSourceProps,
  descendantIds,
  showAgentBadges = true,
  runState,
  label,
  trailing,
}: PlanningRowViewProps) {
  const caret = expandable ? (expanded ? "▾" : "▸") : " ";

  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={isSelected}
      data-task-id={id}
      tabIndex={-1}
      {...dragSourceProps}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        if ((event.target as Element).closest("[data-task-expand-toggle]")) return;
        beginTaskDetailFromClick(id, event.timeStamp);
      }}
      onClick={(event) => {
        recordTaskDetailClick(id, event.timeStamp);
        onClick(id);
      }}
      onPointerEnter={preloadDescriptionEditor}
      className={`flex min-w-0 cursor-pointer items-center px-1 py-0.5 outline-none ${
        isSelected
          ? "bg-selection-bg text-text-primary"
          : "text-text-primary hover:bg-pane-title"
      }`}
      style={{ paddingLeft: `${depth * 2}ch` }}
    >
      {/* Expand / Collapse Indicator Caret — clickable hit area when the
          row has children, so users can toggle subtasks without the keyboard. */}
      {expandable ? (
        <span
          role="button"
          data-task-expand-toggle
          aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
          onClick={(e) => {
            // Don't let the toggle also fire the row's select handler.
            e.stopPropagation();
            onToggleExpand(id);
          }}
          className="mr-1 -my-0.5 inline-block w-4 shrink-0 cursor-pointer self-stretch text-center text-text-muted hover:text-text-primary"
        >
          {caret}
        </span>
      ) : (
        <span className="mr-1 inline-block w-4 shrink-0 text-center text-text-muted">
          {caret}
        </span>
      )}

      {label ?? (
        <WorkItemRowLabel
          identifier={identifier}
          stateColor={stateColor}
          name={name}
        />
      )}

      {trailing}

      {runState ? (
        <span className="ml-2">
          <LifecycleBadge state={runState} showLabel={false} alwaysShowCount />
        </span>
      ) : null}

      {showAgentBadges ? (
        <>
          <AutomationDeliveryChicklet
            issueId={id}
            descendantIds={descendantIds}
            className="ml-2"
          />
          <AutomationFailureChicklet
            issueId={id}
            descendantIds={descendantIds}
            className="ml-2"
          />
          <AgentStateBadge
            issueId={id}
            descendantIds={descendantIds}
            className="ml-2"
          />
        </>
      ) : null}
    </li>
  );
}
