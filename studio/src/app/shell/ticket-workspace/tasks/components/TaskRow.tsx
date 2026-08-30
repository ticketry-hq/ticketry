import React, { useMemo } from "react";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";
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
import { useStudioStore } from "../../../../../features/projects";
import { WorkItemRowLabel } from "./WorkItemRowLabel";
import { useClientStore } from "../../../../../state/clientStore";
import {
  useModuleOpen,
} from "../../../../../features/work-items";
import { stateById, useCachedStates } from "../../../../../features/projects";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import { instantRunPlanningRowId } from "../internal/instantRunTicketNavigation";

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
  recordSelectionProfilePoint("task-row-render");
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
      isSelected={isSelected}
      onClick={onClick}
      onToggleExpand={onToggleExpand}
      dragSourceProps={dragSourceProps}
    />
  );
});

function WorkItemPlanningRow({
  row,
  isSelected,
  onClick,
  onToggleExpand,
  dragSourceProps,
}: Omit<TaskRowProps, "row"> & { row: WorkItemRow }) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const states = useCachedStates(projectId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const { tree, items } = useModuleOpen(moduleId);
  const task = items.find((item) => item.id === row.id);
  const descendantIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set([row.id]);
    const pending = [...(tree.children[row.id] ?? [])];
    while (pending.length) {
      const id = pending.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      pending.push(...(tree.children[id] ?? []));
    }
    return ids;
  }, [row.id, tree]);
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
      descendantIds={row.expanded ? [] : descendantIds}
    />
  );
}

function InstantRunPlanningRow({
  row,
  isSelected,
  onClick,
  dragSourceProps,
}: Pick<TaskRowProps, "isSelected" | "onClick" | "dragSourceProps"> & {
  row: InstantRunRow;
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
