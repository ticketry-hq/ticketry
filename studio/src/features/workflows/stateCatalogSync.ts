import type { State, WorkItem } from "../../shared/api/types";
import { compareStateOrder } from "../../shared/utilities/display";
import { useTasksStore } from "../studio/stores/tasksStore";
import { useUIStore } from "../studio/stores/uiStore";
import { useIssueStore } from "../work-items/issue-detail";
import { advanceStateCatalogRevision } from "../../shared/stateCatalogRevision";
import { getStatesSnapshot, setStates } from "../../shared/query/stateCatalog";

type CatalogState = Pick<State, "id" | "group"> & {
  sort_order?: number;
};

function upsertCanonicalState<T extends CatalogState>(
  states: T[],
  authoritative: T,
): T[] {
  return [
    ...states.filter((state) => state.id !== authoritative.id),
    authoritative,
  ].sort(compareStateOrder);
}

export interface TaskState {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  sort_order?: number;
}

export function toTaskState(state: State): TaskState {
  return {
    id: state.id,
    name: state.name,
    group: state.group,
    color: state.color,
    sort_order: state.sort_order,
  };
}

export function replaceTaskState<T extends { state: TaskState }>(
  task: T,
  authoritative: TaskState,
): T {
  return task.state.id === authoritative.id
    ? { ...task, state: authoritative } as T
    : task;
}

export function replaceWorkItemState(
  item: WorkItem,
  authoritative: State,
): WorkItem {
  return item.state?.id === authoritative.id
    ? { ...item, state: authoritative }
    : item;
}

/**
 * Apply one authoritative server state to every active Studio catalog for the
 * project. The returned array is the initiating Workflow Settings catalog.
 */
export function synchronizeActiveStateCatalogs(
  projectId: string,
  authoritative: State,
  workflowStates: State[],
): State[] {
  advanceStateCatalogRevision(projectId, authoritative);
  const taskCatalog = useTasksStore.getState();
  const previousName =
    (taskCatalog.selectedProjectId === projectId
      ? taskCatalog.states.find((state) => state.id === authoritative.id)?.name
      : undefined) ??
    getStatesSnapshot(projectId).find((state) => state.id === authoritative.id)
      ?.name ??
    workflowStates.find((state) => state.id === authoritative.id)?.name;

  useTasksStore.setState((current) => {
    if (current.selectedProjectId !== projectId) return current;
    const localStates = current.states.filter((state) => state.id === null);
    const realStates = current.states.filter((state) => state.id !== null);
    const taskState = toTaskState(authoritative);
    return {
      states: [
        ...localStates,
        ...upsertCanonicalState(realStates, taskState),
      ],
      tasks: current.tasks.map((task) => replaceTaskState(task, taskState)),
      subtasks: Object.fromEntries(
        Object.entries(current.subtasks).map(([parentId, children]) => [
          parentId,
          children.map((task) => replaceTaskState(task, taskState)),
        ]),
      ),
      details: current.details
        ? {
            ...current.details,
            task: replaceTaskState(current.details.task, taskState),
          }
        : null,
      pendingStateDeltas: Object.fromEntries(
        Object.entries(current.pendingStateDeltas).map(([taskId, delta]) => [
          taskId,
          delta.state.id === taskState.id
            ? { ...delta, state: taskState }
            : delta,
        ]),
      ),
    };
  });

  // One shared catalog, one write — every surface reading it (the backlog,
  // planning views, settings) sees the rename without its own copy to patch.
  setStates(
    projectId,
    upsertCanonicalState(getStatesSnapshot(projectId), authoritative),
  );

  const owner = useIssueStore.getState();
  owner.hydrateWorkItems(
    Object.values(owner.workItemsById)
      .filter((item) => item.project_id === projectId)
      .map((item) => replaceWorkItemState(item, authoritative)),
  );

  if (previousName) {
    useUIStore.getState().renameCollapsedState(
      previousName,
      authoritative.name,
    );
  }

  return upsertCanonicalState(workflowStates, authoritative);
}

/**
 * Replace every active project catalog with the server's complete canonical
 * order while retaining local-only states such as the Scratch section.
 */
export function synchronizeActiveStateCatalogOrder(
  projectId: string,
  authoritative: State[],
): State[] {
  advanceStateCatalogRevision(projectId, authoritative);
  const ordered = [...authoritative].sort(compareStateOrder);

  useTasksStore.setState((current) => {
    if (current.selectedProjectId !== projectId) return current;
    const localStates = current.states.filter((state) => state.id === null);
    return {
      states: [...localStates, ...ordered.map(toTaskState)],
    };
  });

  setStates(projectId, ordered);

  return ordered;
}
