import React from "react";
import {
  formatWorkItemDisplayIdentifier,
  useWorkItem,
} from "../../../../../features/work-items";
import {
  type InstantRunRow,
  type Row,
  type ScratchRow,
  type WorkItemRow,
} from "../TasksPane";
import {
  AgentStateBadge,
  AutomationFailureChicklet,
} from "../../../../../features/agents/lifecycle";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { WorkItemRowLabel } from "./WorkItemRowLabel";
import { stateById, useCachedStates } from "../../../../../features/projects";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import {
  instantRunPlanningRowId,
  usePlanningRowSelected,
} from "../internal/instantRunTicketNavigation";

// Warm the description-editor chunk on first row hover so it is already
// cached when a selected issue's details render. Fired at most once.
let editorWarmed = false;
const preloadDescriptionEditor = () => {
  if (editorWarmed) return;
  editorWarmed = true;
  void import("../../selected-ticket/documents/DescriptionEditor");
};

const recordSelectionProfilePoint = (point: string) => {
  (globalThis as typeof globalThis & {
    __ticketrySelectionProfileProbe?: (point: string) => void;
  }).__ticketrySelectionProfileProbe?.(point);
};

interface TaskRowProps {
  row: Row;
  descendantIds: string[];
  // Id-taking handlers keep the parent's props referentially stable across
  // renders, so React.memo actually skips unchanged rows.
  onClick: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  dragSourceProps?: DragSourceProps;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (
    left.length === right.length && left.every((id, index) => id === right[index])
  );
}

function sameRow(left: Row, right: Row): boolean {
  if (left === right) return true;
  if (left.kind === "work-item" && right.kind === "work-item") {
    return left.id === right.id
      && left.depth === right.depth
      && left.parentId === right.parentId
      && left.expandable === right.expandable
      && left.expanded === right.expanded;
  }
  if (left.kind === "scratch" && right.kind === "scratch") {
    return left.moduleId === right.moduleId;
  }
  if (left.kind === "instant-run" && right.kind === "instant-run") {
    return left.runId === right.runId
      && left.moduleId === right.moduleId
      && left.name === right.name
      && left.startedAt === right.startedAt;
  }
  return false;
}

function sameTaskRowProps(left: TaskRowProps, right: TaskRowProps): boolean {
  return sameRow(left.row, right.row)
    && sameIds(left.descendantIds, right.descendantIds)
    && left.onClick === right.onClick
    && left.onToggleExpand === right.onToggleExpand
    && left.dragSourceProps === right.dragSourceProps;
}

export const TaskRow = React.memo(function TaskRow({
  row,
  descendantIds,
  onClick,
  onToggleExpand,
  dragSourceProps,
}: TaskRowProps) {
  const id = row.kind === "work-item"
    ? row.id
    : row.kind === "instant-run"
      ? instantRunPlanningRowId(row.runId)
      : TEMP_TASK_ID;
  const isSelected = usePlanningRowSelected(id);
  return row.kind === "scratch" ? (
    <ScratchPlanningRow
      row={row}
      isSelected={isSelected}
      onClick={onClick}
      dragSourceProps={dragSourceProps}
    />
  ) : row.kind === "instant-run" ? (
    <InstantRunPlanningRow
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
}: Omit<TaskRowProps, "row"> & { row: WorkItemRow; isSelected: boolean }) {
  const { data: task } = useWorkItem(row.id);
  const states = useCachedStates(task?.project_id ?? null);
  if (!task) return null;

  return (
    <PlanningRowView
      id={row.id}
      depth={row.depth}
      expandable={row.expandable}
      expanded={row.expanded}
      identifier={formatWorkItemDisplayIdentifier(task.sequence_id)}
      stateColor={stateById(states, task.state)?.color ?? null}
      name={task.name}
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={onToggleExpand}
      dragSourceProps={dragSourceProps}
      descendantIds={descendantIds}
    />
  );
}

function InstantRunPlanningRow({
  row,
  isSelected,
  onClick,
  dragSourceProps,
}: Pick<TaskRowProps, "onClick" | "dragSourceProps"> & {
  row: InstantRunRow;
  isSelected: boolean;
}) {
  const id = instantRunPlanningRowId(row.runId);
  return (
    <PlanningRowView
      id={id}
      depth={0}
      expandable={false}
      expanded={false}
      identifier=""
      stateColor={null}
      name={row.name}
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={() => undefined}
      dragSourceProps={dragSourceProps}
      descendantIds={[]}
      showAgentBadges={false}
    />
  );
}

function ScratchPlanningRow({
  isSelected,
  onClick,
  dragSourceProps,
}: Pick<TaskRowProps, "onClick" | "dragSourceProps"> & {
  row: ScratchRow;
  isSelected: boolean;
}) {
  return (
    <PlanningRowView
      id={TEMP_TASK_ID}
      depth={0}
      expandable={false}
      expanded={false}
      identifier=""
      stateColor={null}
      name="New conversation"
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={() => undefined}
      dragSourceProps={dragSourceProps}
      descendantIds={[]}
      showAgentBadges={false}
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
  showAgentBadges?: boolean;
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
  showAgentBadges = true,
}: PlanningRowViewProps) {
  recordSelectionProfilePoint("task-row-render");
  const caret = expandable ? (expanded ? "▾" : "▸") : " ";

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

      {showAgentBadges ? (
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
      ) : null}
    </li>
  );
}
