import {
  getConfigSnapshot,
  type ConfigSnapshot,
} from "../../features/studio/stores/configStore";
import { useTasksStore } from "../../features/studio/stores/tasksStore";
import { useUIStore } from "../../features/studio/stores/uiStore";
import type {
  FlatRow,
  Row,
} from "../shell/ticket-workspace/tasks/TasksPane";
import { focusIdeaEntry } from "../shell/ticket-workspace/tasks/storiesFocus";

type Direction = 1 | -1;

export interface NavigationContext {
  event: KeyboardEvent;
  taskRows: Row[];
  cfg: ConfigSnapshot;
  tasks: ReturnType<typeof useTasksStore.getState>;
  ui: ReturnType<typeof useUIStore.getState>;
}

export function createNavigationContext(
  event: KeyboardEvent,
  taskRows: Row[],
): NavigationContext {
  return {
    event,
    taskRows,
    cfg: getConfigSnapshot(),
    tasks: useTasksStore.getState(),
    ui: useUIStore.getState(),
  };
}

export function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function selectedTaskIndex(
  rows: Row[],
  selectedTaskId: string | null,
): number {
  if (!selectedTaskId) return -1;
  return rows.findIndex(
    (row) => "task" in row && row.task.id === selectedTaskId,
  );
}

export function selectTaskAt(rows: Row[], index: number): void {
  const row = rows[index];
  if (!row || !("task" in row)) return;
  useTasksStore.setState({
    selectedTaskId: row.task.id,
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

export function currentTaskRow(ctx: NavigationContext): FlatRow | null {
  const selected = selectedTaskIndex(ctx.taskRows, ctx.tasks.selectedTaskId);
  const row = ctx.taskRows[selected];
  return row && "task" in row ? row : null;
}

function taskIndexFrom(
  rows: Row[],
  start: number,
  direction: Direction,
): number {
  let index = start + direction;
  while (index >= 0 && index < rows.length) {
    if ("task" in rows[index]) return index;
    index += direction;
  }
  return -1;
}
