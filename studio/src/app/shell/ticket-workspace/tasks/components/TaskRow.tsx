import React from "react";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";
import {
  type Row,
  type ScratchRow,
  type WorkItemRow,
} from "../TasksPane";
import {
  AgentStateBadge,
  AutomationFailureChicklet,
  ScratchStateBadge,
} from "../../../../../features/agents/lifecycle";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { useStudioStore } from "../../../../../features/projects";
import { WorkItemRowLabel } from "./WorkItemRowLabel";
import { useWorkItem } from "../../../../../features/work-items";
import { useCachedState } from "../../../../../features/projects";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";

// Warm the description-editor chunk on first row hover so it is already
// cached when a selected issue's details render. Fired at most once.
let editorWarmed = false;
const preloadDescriptionEditor = () => {
  if (editorWarmed) return;
  editorWarmed = true;
  void import("../../selected-ticket/documents/DescriptionEditor");
};

interface TaskRowProps {
  row: Row;
  descendantIds: string[];
  isSelected: boolean;
  // Id-taking handlers keep the parent's props referentially stable across
  // renders, so React.memo actually skips unchanged rows.
  onClick: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  dragSourceProps?: DragSourceProps;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((id, index) => id === right[index]);
}

function sameRow(left: Row, right: Row): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "scratch" && right.kind === "scratch") {
    return left.moduleId === right.moduleId;
  }
  return left.kind === "work-item" && right.kind === "work-item" &&
    left.id === right.id &&
    left.depth === right.depth &&
    left.parentId === right.parentId &&
    left.expandable === right.expandable &&
    left.expanded === right.expanded;
}

function sameTaskRowProps(left: TaskRowProps, right: TaskRowProps): boolean {
  if (
    !sameRow(left.row, right.row) ||
    left.isSelected !== right.isSelected ||
    left.onClick !== right.onClick ||
    left.onToggleExpand !== right.onToggleExpand ||
    left.dragSourceProps?.draggable !== right.dragSourceProps?.draggable ||
    left.dragSourceProps?.onDragStart !== right.dragSourceProps?.onDragStart ||
    left.dragSourceProps?.onDragEnd !== right.dragSourceProps?.onDragEnd
  ) {
    return false;
  }
  if (left.row.kind === "scratch" || right.row.kind === "scratch") return true;
  return sameIds(left.descendantIds, right.descendantIds);
}

export const TaskRow = React.memo(function TaskRow({
  row,
  descendantIds,
  isSelected,
  onClick,
  onToggleExpand,
  dragSourceProps,
}: TaskRowProps) {
  return row.kind === "scratch" ? (
    <ScratchPlanningRow
      row={row}
      isSelected={isSelected}
      onClick={onClick}
      dragSourceProps={dragSourceProps}
    />
  ) : (
    <WorkItemPlanningRow
      row={row}
      descendantIds={descendantIds}
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={onToggleExpand}
      dragSourceProps={dragSourceProps}
    />
  );
}, sameTaskRowProps);

function WorkItemPlanningRow({
  row,
  descendantIds,
  isSelected,
  onClick,
  onToggleExpand,
  dragSourceProps,
}: Omit<TaskRowProps, "row"> & { row: WorkItemRow }) {
  const { data: task } = useWorkItem(row.id);
  const state = useCachedState(task?.state ?? null);
  if (!task) return null;

  return (
    <PlanningRowView
      id={row.id}
      depth={row.depth}
      expandable={row.expandable}
      expanded={row.expanded}
      identifier={formatWorkItemDisplayIdentifier(task.sequence_id)}
      stateColor={state?.color ?? null}
      name={task.name}
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={onToggleExpand}
      dragSourceProps={dragSourceProps}
      descendantIds={row.expanded ? [] : descendantIds}
    />
  );
}

function ScratchPlanningRow({
  row,
  isSelected,
  onClick,
  dragSourceProps,
}: Pick<TaskRowProps, "isSelected" | "onClick" | "dragSourceProps"> & {
  row: ScratchRow;
}) {
  return (
    <PlanningRowView
      id={TEMP_TASK_ID}
      depth={0}
      expandable={false}
      expanded={false}
      identifier=""
      stateColor={null}
      name="Local scratch workspace"
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={() => undefined}
      dragSourceProps={dragSourceProps}
      descendantIds={[]}
      scratchModuleId={row.moduleId}
    />
  );
}

interface PlanningRowViewProps {
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
  scratchModuleId?: string;
}

function PlanningRowView({
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
  scratchModuleId,
}: PlanningRowViewProps) {
  const caret = expandable ? (expanded ? "▾" : "▸") : " ";
  const isScratch = scratchModuleId !== undefined;

  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={isSelected}
      data-task-id={id}
      tabIndex={-1}
      {...dragSourceProps}
      onClick={() => onClick(id)}
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

      <WorkItemRowLabel
        identifier={identifier}
        stateColor={stateColor}
        name={name}
      />

      {isScratch ? (
        <ScratchTaskStateBadge moduleId={scratchModuleId} />
      ) : (
        <>
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
      )}
    </li>
  );
}

// Only the scratch row needs module-scoped lifecycle status; keeping these
// subscriptions here means ordinary rows never evaluate the agent-status
// selector on status updates.
function ScratchTaskStateBadge({ moduleId }: { moduleId: string }) {
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  return (
    <ScratchStateBadge
      projectId={selectedProjectId}
      moduleId={moduleId}
      className="ml-2"
    />
  );
}
