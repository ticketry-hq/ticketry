import {
  getConfigSnapshot,
  type ConfigSnapshot,
} from "../../features/studio/stores/configStore";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { useClientStore } from "../../state/clientStore";
import type {
  TreeRow,
  WorkItemRow,
} from "../shell/ticket-workspace/tasks/TasksPane";
import {
  isPlanningRow,
  planningRowId,
} from "../shell/ticket-workspace/tasks/TasksPane";
import { focusIdeaEntry } from "../shell/ticket-workspace/tasks/storiesFocus";

type Direction = 1 | -1;

export interface NavigationContext {
  event: KeyboardEvent;
  taskRows: TreeRow[];
  cfg: ConfigSnapshot;
  tasks: ReturnType<typeof useTasksStore.getState>;
  ui: ReturnType<typeof useClientStore.getState>;
}

export function createNavigationContext(
  event: KeyboardEvent,
  taskRows: TreeRow[],
): NavigationContext {
  return {
    event,
    taskRows,
    cfg: getConfigSnapshot(),
    tasks: useTasksStore.getState(),
    ui: useClientStore.getState(),
  };
}

export function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function selectedTaskIndex(
  rows: TreeRow[],
  selectedTaskId: string | null,
): number {
  if (!selectedTaskId) return -1;
  return rows.findIndex(
    (row) => isPlanningRow(row) && planningRowId(row) === selectedTaskId,
  );
}

export function selectTaskAt(rows: TreeRow[], index: number): void {
  const row = rows[index];
  if (!row || !isPlanningRow(row)) return;
  useTasksStore.setState({
    selectedTaskId: planningRowId(row),
    workspaceSelection: { kind: "task" },
  });
}

export function moveTaskSelection(
  ctx: NavigationContext,
  direction: Direction,
): boolean {
  consume(ctx.event);
  const selected = selectedTaskIndex(ctx.taskRows, ctx.tasks.selectedTaskId);
  const firstTask = taskIndexFrom(ctx.taskRows, -1, 1);
  if (direction === -1 && selected === firstTask) {
    focusIdeaEntry();
    return true;
  }
  const start =
    selected >= 0
      ? selected
      : direction === 1
        ? -1
        : ctx.taskRows.length;
  const next = taskIndexFrom(ctx.taskRows, start, direction);
  if (next >= 0) selectTaskAt(ctx.taskRows, next);
  return true;
}

export function currentTaskRow(ctx: NavigationContext): WorkItemRow | null {
  const selected = selectedTaskIndex(ctx.taskRows, ctx.tasks.selectedTaskId);
  const row = ctx.taskRows[selected];
  return row?.kind === "work-item" ? row : null;
}

function taskIndexFrom(
  rows: TreeRow[],
  start: number,
  direction: Direction,
): number {
  let index = start + direction;
  while (index >= 0 && index < rows.length) {
    if (isPlanningRow(rows[index])) return index;
    index += direction;
  }
  return -1;
}
