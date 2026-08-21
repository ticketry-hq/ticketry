import {
  getModulesSnapshot,
  getProjectsSnapshot,
} from "../../features/projects";
import { useStudioStore } from "../../features/projects/store";
import { getModuleTreeSnapshot } from "../../features/work-items/queries";
import { getStatesSnapshot } from "../../shared/query/stateCatalog";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import type { Module, ModuleTree, Project, State, WorkItem } from "../../shared/api/types";
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
  tasks: NavigationTasks;
  ui: ReturnType<typeof useClientStore.getState>;
}

export interface NavigationTasks {
  projects: Project[];
  modules: Module[];
  tree: ModuleTree;
  itemsById: Record<string, WorkItem>;
  states: State[];
  selectedProjectId: string | null;
  selectedModuleId: string | null;
  selectedTaskId: string | null;
  selectProject: (id: string) => Promise<void>;
  selectModule: (id: string) => Promise<void>;
}

export function createNavigationContext(
  event: KeyboardEvent,
  taskRows: TreeRow[],
): NavigationContext {
  const project = useStudioStore.getState();
  const ui = useClientStore.getState();
  const tree = getModuleTreeSnapshot(project.selectedProjectId, ui.selectedModuleId);
  const itemsById = Object.fromEntries(
    tree.order.flatMap((id) => {
      const item = queryClient.getQueryData<WorkItem>(queryKeys.workItems.byId(id));
      return item ? [[id, item] as const] : [];
    }),
  );
  return {
    event,
    taskRows,
    tasks: {
      projects: getProjectsSnapshot(),
      modules: getModulesSnapshot(project.selectedProjectId),
      tree,
      itemsById,
      states: getStatesSnapshot(project.selectedProjectId),
      selectedProjectId: project.selectedProjectId,
      selectedModuleId: ui.selectedModuleId,
      selectedTaskId: ui.selectedTaskId,
      selectProject: project.selectProject,
      selectModule: ui.selectModule,
    },
    ui,
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
  useClientStore.setState({
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
