import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  ModuleTree,
  WorkItem,
} from "../../../shared/api/types";
import { setStatesSorted } from "../../../shared/query/stateCatalog";
import {
  FIVE_MINUTES,
  queryClient,
} from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import {
  readBatchedWorkItem,
  readWorkItemAttachments,
  readModuleTreeRecords,
  readProjectWorkItems,
} from "./readTransport";

/**
 * Canonical read boundary for work-item server state.
 *
 * Zustand stores may still project these records while their consumers are
 * migrated, but requests, cancellation, de-duplication, staleness and errors
 * belong to TanStack Query here.
 */

export const workItemQuery = (id: string) => ({
  queryKey: queryKeys.workItems.byId(id),
  queryFn: () => readBatchedWorkItem(id),
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
      const { rootIds, children, order, workItems, states } = await readModuleTreeRecords(
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

/** Subscribe to the attachment subcollection without re-reading its work item. */
export function useWorkItemAttachments(id: string | null) {
  return useQuery(
    {
      queryKey: queryKeys.workItems.attachments(id ?? "no-work-item"),
      queryFn: () => readWorkItemAttachments(id!),
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

export { readProjectWorkItems };
