import type { State, WorkItem } from "../../shared/api/types";
import { compareStateOrder } from "../../shared/utilities/display";
import { useTasksStore } from "../studio/stores/tasksStore";
import { useBacklogStore } from "../work-items";
import { useIssueStore } from "../work-items/issue-detail";
import {
  type TaskState,
  toTaskState,
} from "./stateCatalogSync";

function replaceRemovedTaskState<T extends { state: TaskState }>(
  task: T,
  removedStateId: string,
  replacement: TaskState | null,
): T {
  return task.state.id === removedStateId && replacement
    ? { ...task, state: replacement } as T
    : task;
}

function replaceRemovedWorkItemState(
  item: WorkItem,
  removedStateId: string,
  replacement: State | null,
): WorkItem {
  return item.state?.id === removedStateId && replacement
    ? { ...item, state: replacement }
    : item;
}

function collectAffectedIds(projectId: string, removedStateId: string): Set<string> {
  const affected = new Set<string>();
  const tasks = useTasksStore.getState();
  if (tasks.selectedProjectId === projectId) {
    for (const task of tasks.tasks) {
      if (task.state.id === removedStateId) affected.add(task.id);
    }
    for (const children of Object.values(tasks.subtasks)) {
      for (const task of children) {
        if (task.state.id === removedStateId) affected.add(task.id);
      }
    }
    if (tasks.details?.task.state.id === removedStateId) {
      affected.add(tasks.details.task.id);
    }
    for (const [taskId, delta] of Object.entries(tasks.pendingStateDeltas)) {
      if (delta.state.id === removedStateId) affected.add(taskId);
    }
  }

  const backlog = useBacklogStore.getState();
  if (backlog.projectId === projectId) {
    for (const item of backlog.items) {
      if (item.state?.id === removedStateId) affected.add(item.id);
    }
    for (const [itemId, delta] of Object.entries(backlog.pendingStateDeltas)) {
      if (delta.state?.id === removedStateId) affected.add(itemId);
    }
  }

  const issue = useIssueStore.getState();
  if (
    issue.open?.task.project_id === projectId &&
    issue.open.task.state?.id === removedStateId
  ) {
    affected.add(issue.open.task.id);
  }
  for (const child of issue.children) {
    if (
      child.project_id === projectId &&
      child.state?.id === removedStateId
    ) {
      affected.add(child.id);
    }
  }
  return affected;
}

/**
 * Remove a confirmed-dead state synchronously, before any authoritative
 * refresh can leave an already-open picker with a stale submit target.
 */
export function prepareActiveStateRemoval(
  projectId: string,
  removedStateId: string,
  replacement: State | null,
  workflowStates: State[],
): { affectedIds: Set<string>; workflowStates: State[] } {
  const affectedIds = collectAffectedIds(projectId, removedStateId);
  const nextWorkflowStates = workflowStates.filter(
    (state) => state.id !== removedStateId,
  );
  const replacementTaskState = replacement ? toTaskState(replacement) : null;

  useTasksStore.setState((current) => {
    if (current.selectedProjectId !== projectId) return current;
    const localStates = current.states.filter((state) => state.id === null);
    const realStates = current.states.filter(
      (state) => state.id !== null && state.id !== removedStateId,
    );
    const pendingStateDeltas = Object.fromEntries(
      Object.entries(current.pendingStateDeltas).flatMap(([taskId, delta]) => {
        if (delta.state.id !== removedStateId) return [[taskId, delta]];
        return replacementTaskState
          ? [[taskId, { ...delta, state: replacementTaskState }]]
          : [];
      }),
    );
    return {
      states: [...localStates, ...realStates],
      tasks: current.tasks.map((task) =>
        replaceRemovedTaskState(task, removedStateId, replacementTaskState)),
      subtasks: Object.fromEntries(
        Object.entries(current.subtasks).map(([parentId, children]) => [
          parentId,
          children.map((task) =>
            replaceRemovedTaskState(task, removedStateId, replacementTaskState)),
        ]),
      ),
      details: current.details
        ? {
            ...current.details,
            task: replaceRemovedTaskState(
              current.details.task,
              removedStateId,
              replacementTaskState,
            ),
          }
        : null,
      pendingStateDeltas,
    };
  });

  useBacklogStore.setState((current) => {
    if (current.projectId !== projectId) return current;
    const pendingStateDeltas = Object.fromEntries(
      Object.entries(current.pendingStateDeltas).flatMap(([itemId, delta]) => {
        if (delta.state?.id !== removedStateId) return [[itemId, delta]];
        return replacement
          ? [[itemId, { ...delta, state: replacement }]]
          : [];
      }),
    );
    return {
      states: current.states.filter((state) => state.id !== removedStateId),
      items: current.items.map((item) =>
        replaceRemovedWorkItemState(item, removedStateId, replacement)),
      pendingStateDeltas,
    };
  });

  useIssueStore.setState((current) => ({
    open:
      current.open?.task.project_id === projectId
        ? {
            ...current.open,
            task: replaceRemovedWorkItemState(
              current.open.task,
              removedStateId,
              replacement,
            ),
          }
        : current.open,
    children: current.children.map((item) =>
      item.project_id === projectId
        ? replaceRemovedWorkItemState(item, removedStateId, replacement)
        : item),
  }));

  return { affectedIds, workflowStates: nextWorkflowStates };
}

/**
 * Reconcile the optimistic removal snapshot with post-confirmation server
 * rows. Revision-aware stores retain a newer live-feed frame when one won the
 * race; the issue-detail cache takes the same authoritative work-item row.
 */
export function reconcileActiveStateRemoval(
  projectId: string,
  removedStateId: string,
  affectedIds: Set<string>,
  states: State[],
  workItems: WorkItem[],
): State[] {
  const orderedStates = [...states].sort(compareStateOrder);
  const taskStates = orderedStates.map(toTaskState);

  useTasksStore.setState((current) => {
    if (current.selectedProjectId !== projectId) return current;
    const localStates = current.states.filter((state) => state.id === null);
    return { states: [...localStates, ...taskStates] };
  });
  useBacklogStore.setState((current) =>
    current.projectId === projectId ? { states: orderedStates } : current,
  );

  const authoritativeById = new Map(workItems.map((item) => [item.id, item]));
  const reconciledIds = new Set([
    ...affectedIds,
    ...collectAffectedIds(projectId, removedStateId),
  ]);
  for (const itemId of reconciledIds) {
    const item = authoritativeById.get(itemId);
    if (!item) {
      useBacklogStore
        .getState()
        .removeReconciledItem(itemId, Number.MAX_SAFE_INTEGER);
      useTasksStore
        .getState()
        .removeReconciledTask(itemId, Number.MAX_SAFE_INTEGER);
      continue;
    }
    const revision = item.state_revision ?? 0;
    useBacklogStore.getState().reconcileTargetedItem(item, revision);
    useTasksStore.getState().reconcileTargetedTask(item, revision);
  }

  useIssueStore.setState((current) => {
    const reconcile = (item: WorkItem): WorkItem | null => {
      if (item.project_id !== projectId || !reconciledIds.has(item.id)) {
        return item;
      }
      const authoritative = authoritativeById.get(item.id);
      if (!authoritative) return null;
      return (authoritative.state_revision ?? 0) >= (item.state_revision ?? 0)
        ? authoritative
        : item;
    };
    const openTask = current.open ? reconcile(current.open.task) : null;
    return {
      open: current.open && openTask
        ? { ...current.open, task: openTask }
        : null,
      children: current.children.flatMap((item) => {
        const reconciled = reconcile(item);
        return reconciled ? [reconciled] : [];
      }),
    };
  });

  return orderedStates;
}
