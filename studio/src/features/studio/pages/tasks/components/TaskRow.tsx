import React from "react";
import { formatSequenceId } from "../../../lib/planeUrl";
import { type FlatRow } from "../TasksPane";
import {
  AgentStateBadge,
  AutomationFailureChicklet,
  ScratchStateBadge,
} from "../../../../agents/lifecycle";
import { TEMP_TASK_ID } from "../../../../agents/types";
import { useTasksStore } from "../../../stores/tasksStore";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";

// Warm the description-editor chunk on first row hover so it is already
// cached when a selected issue's details render. Fired at most once.
let editorWarmed = false;
const preloadDescriptionEditor = () => {
  if (editorWarmed) return;
  editorWarmed = true;
  void import("../../../../documents/DescriptionEditor");
};

interface TaskRowProps {
  row: FlatRow;
  isSelected: boolean;
  // Id-taking handlers keep the parent's props referentially stable across
  // renders, so React.memo actually skips unchanged rows.
  onClick: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  dragSourceProps?: DragSourceProps;
}

export const TaskRow = React.memo(function TaskRow({
  row,
  isSelected,
  onClick,
  onToggleExpand,
  dragSourceProps,
}: TaskRowProps) {
  const caret = row.hasChildren ? (row.isExpanded ? "▾" : "▸") : " ";
  const seqStr = formatSequenceId(row.task.sequence_id);
  const identifier = row.task.key ?? seqStr;

  // The scratch row counts ephemeral plan/instant sessions, not backend rows.
  const isScratch = row.task.id === TEMP_TASK_ID;

  return (
    <li
      role="treeitem"
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-selected={isSelected}
      data-task-id={row.task.id}
      tabIndex={-1}
      {...dragSourceProps}
      onClick={() => onClick(row.task.id)}
      onPointerEnter={preloadDescriptionEditor}
      className={`flex min-w-0 cursor-pointer items-center px-1 py-0.5 outline-none ${
        isSelected
          ? "bg-selection-bg text-text-primary"
          : "text-text-primary hover:bg-pane-title"
      }`}
      style={{ paddingLeft: `${row.depth * 2}ch` }}
    >
      {/* Expand / Collapse Indicator Caret — clickable hit area when the
          row has children, so users can toggle subtasks without the keyboard. */}
      {row.hasChildren ? (
        <span
          role="button"
          aria-label={row.isExpanded ? "Collapse subtasks" : "Expand subtasks"}
          onClick={(e) => {
            // Don't let the toggle also fire the row's select handler.
            e.stopPropagation();
            onToggleExpand(row.task.id);
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

      {/* Task Label */}
      <span className="min-w-0 truncate">
        {identifier ? (
          <>
            <span
              data-task-id-token
              className={row.task.state.color ? undefined : "text-text-muted"}
              style={
                row.task.state.color
                  ? { color: row.task.state.color }
                  : undefined
              }
            >
              {identifier}
            </span>
            <span> · </span>
          </>
        ) : null}
        <span>{row.task.name}</span>
      </span>

      {isScratch ? (
        <ScratchTaskStateBadge />
      ) : (
        <>
          <AutomationFailureChicklet
            issueId={row.task.id}
            descendantIds={row.descendantIds}
            className="ml-2"
          />
          <AgentStateBadge
            issueId={row.task.id}
            descendantIds={row.descendantIds}
            className="ml-2"
          />
        </>
      )}
    </li>
  );
});

// Only the scratch row needs module-scoped lifecycle status; keeping these
// subscriptions here means ordinary rows never evaluate the agent-status
// selector on status updates.
function ScratchTaskStateBadge() {
  const selectedProjectId = useTasksStore((state) => state.selectedProjectId);
  const selectedModuleId = useTasksStore((state) => state.selectedModuleId);
  return (
    <ScratchStateBadge
      projectId={selectedProjectId}
      moduleId={selectedModuleId}
      className="ml-2"
    />
  );
}
