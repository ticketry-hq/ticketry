import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import type { ModuleTree } from "../../../shared/api/types";
import type { TaskDetails } from "../lib/types";

// Membership is the only value held by the module-tree entry. Work-item fields
// live in their own `workItem` entries and are resolved only when a surface
// reads an id.
export type TaskTree = ModuleTree;

export const EMPTY_TREE: TaskTree = {
  rootIds: [],
  children: {},
  order: [],
};

const treeKey = (projectId: string, moduleId: string) =>
  queryKeys.tasks.byModule(projectId, moduleId);

const detailsKey = (projectId: string, taskId: string) =>
  queryKeys.tasks.detail(projectId, taskId);

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
  await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({ queryKey, queryFn, staleTime: 0 });
}

export function getTaskDetails(
  projectId: string | null,
  taskId: string | null,
): TaskDetails | null {
  if (!projectId || !taskId) return null;
  return queryClient.getQueryData<TaskDetails>(detailsKey(projectId, taskId)) ?? null;
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

export function useCachedTaskTree(
  projectId: string | null,
  moduleId: string | null,
): TaskTree {
  const { data } = useQuery(
    {
      queryKey:
        projectId && moduleId
          ? treeKey(projectId, moduleId)
          : queryKeys.tasks.emptyTree,
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
          : queryKeys.tasks.emptyDetail,
      queryFn: () => null,
      enabled: false,
    },
    queryClient,
  );
  return data ?? null;
}
