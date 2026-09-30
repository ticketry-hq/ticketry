import React, { useMemo } from "react";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";
import { type Row, type WorkItemRow } from "../TasksPane";
import { InstantRunPlanningRow, ScratchPlanningRow } from "./ConversationRows";
import { PlanningRowView } from "./PlanningRowView";
import { useStudioStore } from "../../../../../features/projects";
import {
  useStoriesTree,
  useWorkItem,
} from "../../../../../features/work-items";
import { stateById, useCachedStates } from "../../../../../features/projects";
import type { DragSourceProps } from "../../../../../shared/dragDrop/useAxisDragAndDrop";
import { recordSelectionProfilePoint } from "../../../../../shared/utilities/selectionProfile";

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
  recordSelectionProfilePoint("work-item-row-render");
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const states = useCachedStates(projectId);
  const { tree } = useStoriesTree();
  const { data: task } = useWorkItem(row.id);
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
