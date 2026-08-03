import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { TaskDetails, TaskId, TaskSummary } from "../lib/types";

// Storage for the Stories tree. The module tree (root rows + subtask buckets)
// is one cache entry per (project, module); an open item's details is its own
// entry per (project, task). tasksStore reads and writes through here rather
// than holding copies, so a module revisit or a second surface sees the same
// rows, and invalidation is available per module instead of store-wide.

export interface TaskTree {
  tasks: TaskSummary[];
  subtasks: Record<TaskId, TaskSummary[]>;
}

const EMPTY_TREE: TaskTree = { tasks: [], subtasks: {} };

const treeKey = (projectId: string, moduleId: string) =>
  queryKeys.tasks.byModule(projectId, moduleId);

const detailsKey = (projectId: string, taskId: string) =>
  [...queryKeys.tasks.all, projectId, "details", taskId] as const;

export function getTaskTree(
  projectId: string | null,
  moduleId: string | null,
): TaskTree {
  if (!projectId || !moduleId) return EMPTY_TREE;
  return queryClient.getQueryData<TaskTree>(treeKey(projectId, moduleId)) ?? EMPTY_TREE;
}

export function setTaskTree(
  projectId: string,
  moduleId: string,
  tree: TaskTree,
): void {
  queryClient.setQueryData(treeKey(projectId, moduleId), tree);
}

export async function loadTaskTree(
  projectId: string,
  moduleId: string,
  queryFn: () => Promise<TaskTree>,
): Promise<TaskTree> {
  const queryKey = treeKey(projectId, moduleId);
  // A module can be left and revisited while its first request is still in
  // flight. The revisited selection is a new explicit load, so cancel the old
  // Query attempt instead of attaching the new selection to stale work.
  await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    queryFn,
    staleTime: 0,
  });
}

export function getTaskDetails(
  projectId: string | null,
  taskId: string | null,
): TaskDetails | null {
  if (!projectId || !taskId) return null;
  return (
    queryClient.getQueryData<TaskDetails>(detailsKey(projectId, taskId)) ?? null
  );
}

export function setTaskDetails(
  projectId: string,
  taskId: string,
  details: TaskDetails | null,
): void {
  if (details === null) {
    queryClient.removeQueries({ queryKey: detailsKey(projectId, taskId) });
    return;
  }
  queryClient.setQueryData(detailsKey(projectId, taskId), details);
}

export function loadTaskDetails(
  projectId: string,
  taskId: string,
  queryFn: () => Promise<TaskDetails>,
): Promise<TaskDetails> {
  return queryClient.fetchQuery({
    queryKey: detailsKey(projectId, taskId),
    queryFn,
    staleTime: 0,
  });
}

/**
 * Subscribe to a module's cached tree. The imperative store action currently
 * starts the fetch through loadTaskTree; TanStack owns the request and this
 * hook owns reactive delivery to components.
 */
export function useCachedTaskTree(
  projectId: string | null,
  moduleId: string | null,
): TaskTree {
  const { data } = useQuery(
    {
      queryKey:
        projectId && moduleId
          ? treeKey(projectId, moduleId)
          : [...queryKeys.tasks.all, "none"],
      queryFn: () => EMPTY_TREE,
      enabled: false,
    },
    queryClient,
  );
  return data ?? EMPTY_TREE;
}

export function useCachedTaskDetails(
  projectId: string | null,
  taskId: string | null,
): TaskDetails | null {
  const { data } = useQuery(
    {
      queryKey:
        projectId && taskId
          ? detailsKey(projectId, taskId)
          : [...queryKeys.tasks.all, "no-details"],
      queryFn: () => null,
      enabled: false,
    },
    queryClient,
  );
  return data ?? null;
}
