import * as api from "../../shared/api/client";
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  IssueType,
  ModuleTree,
  State,
  WorkItem,
  WorkItemDetail,
  WorkItemFilters,
} from "../../shared/api/types";
import {
  getStatesSnapshot,
  reloadStates,
  setStatesSorted,
} from "../../shared/query/stateCatalog";
import {
  getIssueTypesSnapshot,
  loadIssueTypes,
} from "../settings";
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

type WorkItemWireRelations = {
  state: string | State | null;
  issue_type: string | IssueType;
};

export function normalizeWorkItemRelations(
  authoritative: WorkItem,
  states: readonly State[],
  issueTypes: readonly IssueType[],
  fallback?: WorkItem,
): WorkItem {
  const raw = authoritative as unknown as WorkItemWireRelations;
  const state =
    typeof raw.state === "string"
      ? states.find((candidate) => candidate.id === raw.state) ??
        (fallback?.state?.id === raw.state ? fallback.state : undefined)
      : raw.state;
  const issueType =
    typeof raw.issue_type === "string"
      ? issueTypes.find((candidate) => candidate.id === raw.issue_type) ??
        (fallback?.issue_type?.id === raw.issue_type
          ? fallback.issue_type
          : undefined)
      : raw.issue_type;

  if (state === undefined) {
    throw new Error(
      `Work item ${authoritative.id} references unknown state ${raw.state}`,
    );
  }
  if (issueType === undefined) {
    throw new Error(
      `Work item ${authoritative.id} references unknown issue type ${raw.issue_type}`,
    );
  }
  return { ...authoritative, state, issue_type: issueType } as WorkItem;
}

async function normalizeFetchedWorkItem(raw: WorkItem): Promise<WorkItem> {
  const relations = raw as unknown as WorkItemWireRelations;
  const projectId = raw.project_id;
  let states = getStatesSnapshot(projectId);
  let issueTypes = getIssueTypesSnapshot(projectId);

  if (
    typeof relations.state === "string" &&
    !states.some((state) => state.id === relations.state)
  ) {
    states = await reloadStates(projectId);
  }
  if (
    typeof relations.issue_type === "string" &&
    !issueTypes.some((issueType) => issueType.id === relations.issue_type)
  ) {
    issueTypes = await loadIssueTypes(projectId);
  }
  return normalizeWorkItemRelations(raw, states, issueTypes);
}

export const workItemQuery = (id: string) => ({
  queryKey: queryKeys.workItems.byId(id),
  queryFn: async () => normalizeFetchedWorkItem(await fetchWorkItem(id)),
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
  return queryClient.fetchQuery(moduleTreeQuery(projectId, moduleId));
}

function moduleTreeQuery(projectId: string, moduleId: string) {
  return {
    queryKey: queryKeys.tasks.byModule(projectId, moduleId),
    staleTime: 0,
    queryFn: async () => {
      const { rootIds, children, order, states, workItems } = await api.getTasks(
        projectId,
        moduleId,
      );
      setStatesSorted(projectId, states);
      for (const item of workItems) {
        const locallyMutating = queryClient.isMutating({
          predicate: (mutation) =>
            (mutation.state.variables as { id?: unknown } | undefined)?.id ===
            item.id,
        });
        if (locallyMutating > 0) continue;
        queryClient.setQueryData<WorkItem>(
          queryKeys.workItems.byId(item.id),
          (current) =>
            current && current.state_revision > item.state_revision
              ? current
              : item,
        );
      }
      return { rootIds, children, order };
    },
  };
}

export function useModuleTree(
  projectId: string | null,
  moduleId: string | null,
): ModuleTree {
  const { data } = useQuery<ModuleTree, Error, ModuleTree>(
    projectId && moduleId
      ? moduleTreeQuery(projectId, moduleId)
      : {
          queryKey: queryKeys.tasks.emptyTree,
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
      queryFn: async ({ signal: querySignal }) => {
        const detail = await api.getWorkItem(keyOrId, querySignal);
        return {
          ...detail,
          task: await normalizeFetchedWorkItem(detail.task),
        };
      },
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
    queryFn: async () =>
      Promise.all(
        (await api.listProjectWorkItems(projectId, filters)).map(
          normalizeFetchedWorkItem,
        ),
      ),
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
    queryFn: async () =>
      Promise.all(
        (await api.listProjectWorkItems(projectId, { parent: parentId })).map(
          normalizeFetchedWorkItem,
        ),
      ),
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
