import * as api from "../../shared/api/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  ModuleTree,
  WorkItem,
  WorkItemDetail,
  WorkItemFilters,
} from "../../shared/api/types";
import { setStatesSorted } from "../../shared/query/stateCatalog";
import {
  FIVE_MINUTES,
  queryClient,
} from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { fetchWorkItem } from "../../shared/api/workItemBatcher";

/**
 * Canonical read boundary for work-item server state.
 *
 * Zustand stores may still project these records while their consumers are
 * migrated, but requests, cancellation, de-duplication, staleness and errors
 * belong to TanStack Query here.
 */

export const workItemQuery = (id: string) => ({
  queryKey: queryKeys.workItems.byId(id),
  queryFn: () => fetchWorkItem(id),
  staleTime: FIVE_MINUTES,
});

export const EMPTY_MODULE_TREE: ModuleTree = {
  rootIds: [],
  children: {},
  order: [],
};

export function getModuleTreeSnapshot(
  projectId: string | null,
  moduleId: string | null,
): ModuleTree {
  if (!projectId || !moduleId) return EMPTY_MODULE_TREE;
  return (
    queryClient.getQueryData<ModuleTree>(
      queryKeys.tasks.byModule(projectId, moduleId),
    ) ?? EMPTY_MODULE_TREE
  );
}

export async function loadModuleTree(
  projectId: string,
  moduleId: string,
): Promise<ModuleTree> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.tasks.byModule(projectId, moduleId),
    staleTime: 0,
    queryFn: async () => {
      const { rootIds, children, order, states } = await api.getTasks(
        projectId,
        moduleId,
      );
      setStatesSorted(projectId, states);
      return { rootIds, children, order };
    },
  });
}

export function useModuleTree(
  projectId: string | null,
  moduleId: string | null,
): ModuleTree {
  const { data } = useQuery(
    {
      queryKey:
        projectId && moduleId
          ? queryKeys.tasks.byModule(projectId, moduleId)
          : queryKeys.tasks.emptyTree,
      queryFn: () => EMPTY_MODULE_TREE,
      enabled: false,
    },
    queryClient,
  );
  return data ?? EMPTY_MODULE_TREE;
}

/** Subscribe to the one server-state holding for a work item. */
export function useWorkItem(id: string | null) {
  return useQuery(
    {
      ...workItemQuery(id ?? "no-work-item"),
      enabled: id !== null,
    },
    queryClient,
  );
}

/** Resolve id-only membership without creating a record-shaped collection. */
export function useWorkItemsByIds(ids: readonly string[]): WorkItem[] {
  const results = useQueries(
    { queries: ids.map((id) => workItemQuery(id)) },
    queryClient,
  );
  return results.flatMap(({ data }) => (data ? [data] : []));
}

export async function loadWorkItemDetail(
  keyOrId: string,
  signal?: AbortSignal,
): Promise<WorkItemDetail> {
  const queryKey = queryKeys.workItems.detail(keyOrId);
  const cancel = () => {
    void queryClient.cancelQueries({ queryKey, exact: true });
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal: querySignal }) =>
        api.getWorkItem(keyOrId, querySignal),
      staleTime: 0,
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function loadProjectWorkItems(
  projectId: string,
  filters: WorkItemFilters = {},
): Promise<WorkItem[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workItems.byProject(projectId, filters),
    queryFn: () => api.listProjectWorkItems(projectId, filters),
    staleTime: 0,
  });
}

export function getProjectWorkItemsSnapshot(
  projectId: string,
  filters: WorkItemFilters = {},
): WorkItem[] {
  return (
    queryClient.getQueryData<WorkItem[]>(
      queryKeys.workItems.byProject(projectId, filters),
    ) ?? EMPTY_WORK_ITEMS
  );
}

export function setProjectWorkItems(
  projectId: string,
  filters: WorkItemFilters,
  items: WorkItem[],
): void {
  queryClient.setQueryData(
    queryKeys.workItems.byProject(projectId, filters),
    items,
  );
}

export async function loadChildWorkItems(
  projectId: string,
  parentId: string,
): Promise<WorkItem[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workItems.children(parentId),
    queryFn: () => api.listProjectWorkItems(projectId, { parent: parentId }),
    staleTime: 0,
  });
}

export function getWorkItemDetailSnapshot(
  keyOrId: string,
): WorkItemDetail | null {
  return (
    queryClient.getQueryData<WorkItemDetail>(
      queryKeys.workItems.detail(keyOrId),
    ) ?? null
  );
}

export function setWorkItemDetail(
  keyOrId: string,
  detail: WorkItemDetail,
): void {
  queryClient.setQueryData(queryKeys.workItems.detail(keyOrId), detail);
  if (detail.task.id !== keyOrId) {
    queryClient.setQueryData(
      queryKeys.workItems.detail(detail.task.id),
      detail,
    );
  }
  if (detail.task.key !== keyOrId) {
    queryClient.setQueryData(
      queryKeys.workItems.detail(detail.task.key),
      detail,
    );
  }
}

export function setChildWorkItems(parentId: string, children: WorkItem[]): void {
  queryClient.setQueryData(queryKeys.workItems.children(parentId), children);
}

const EMPTY_WORK_ITEMS: WorkItem[] = [];

export function getChildWorkItemsSnapshot(parentId: string): WorkItem[] {
  return (
    queryClient.getQueryData<WorkItem[]>(
      queryKeys.workItems.children(parentId),
    ) ?? EMPTY_WORK_ITEMS
  );
}

export interface WorkItemIndex {
  workItemsById: Record<string, WorkItem>;
  workItemIdByKey: Record<string, string>;
  childWorkItemIds: Record<string, string[]>;
}

const EMPTY_INDEX: WorkItemIndex = {
  workItemsById: {},
  workItemIdByKey: {},
  childWorkItemIds: {},
};

export function getWorkItemIndexSnapshot(): WorkItemIndex {
  return (
    queryClient.getQueryData<WorkItemIndex>(queryKeys.workItems.index) ??
    EMPTY_INDEX
  );
}

export function setWorkItemIndex(
  workItemsById: Record<string, WorkItem>,
): WorkItemIndex {
  const workItemIdByKey: Record<string, string> = {};
  const childWorkItemIds: Record<string, string[]> = {};
  for (const item of Object.values(workItemsById)) {
    workItemIdByKey[item.key] = item.id;
    if (item.parent_id) {
      (childWorkItemIds[item.parent_id] ??= []).push(item.id);
    }
  }
  const index = { workItemsById, workItemIdByKey, childWorkItemIds };
  queryClient.setQueryData(queryKeys.workItems.index, index);
  return index;
}
