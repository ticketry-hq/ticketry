import { groupAndOrderTasks } from "./presenter";
import type { TaskId, TaskState, TaskSummary } from "./types";

export interface OrderedTaskSection {
  state: TaskState;
  tasks: TaskSummary[];
}

export function orderedTaskSections(
  tasks: readonly TaskSummary[],
  states: readonly TaskState[],
): OrderedTaskSection[] {
  const { groups, orderedStates } = groupAndOrderTasks(
    [...tasks],
    [...states],
  );
  return orderedStates.flatMap((state) => {
    const group = groups[state.name];
    return group?.length ? [{ state, tasks: [...group].reverse() }] : [];
  });
}

export function selectModuleTaskOrder(
  tasks: readonly TaskSummary[],
  states: readonly TaskState[],
  subtasks: Readonly<Record<string, readonly TaskSummary[]>>,
): TaskId[] {
  const order: TaskId[] = [];
  const visited = new Set<TaskId>();

  function appendBranch(task: TaskSummary): void {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    order.push(task.id);
    for (const child of subtasks[task.id] ?? []) appendBranch(child);
  }

  for (const section of orderedTaskSections(tasks, states)) {
    for (const task of section.tasks) appendBranch(task);
  }
  return order;
}

export interface TaskRevealPath {
  ancestorIds: Set<TaskId>;
  stateName: string | null;
}

export function taskRevealPath(
  taskId: TaskId,
  moduleId: string,
  tasks: TaskSummary[],
  subtasks: Record<TaskId, TaskSummary[]>,
): TaskRevealPath {
  const tasksById = new Map<TaskId, TaskSummary>();
  for (const task of tasks) tasksById.set(task.id, task);
  for (const children of Object.values(subtasks)) {
    for (const task of children) tasksById.set(task.id, task);
  }

  const ancestorIds = new Set<TaskId>();
  const visited = new Set<TaskId>([taskId]);
  let task = tasksById.get(taskId);
  while (task?.parent_id && task.parent_id !== moduleId) {
    const parent = tasksById.get(task.parent_id);
    if (!parent || visited.has(parent.id)) break;
    ancestorIds.add(parent.id);
    visited.add(parent.id);
    task = parent;
  }
  return { ancestorIds, stateName: task?.state.name ?? null };
}
