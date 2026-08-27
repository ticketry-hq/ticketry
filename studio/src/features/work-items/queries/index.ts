import { skipToken, useFragment, useQuery } from "@apollo/client/react";
import { useMemo } from "react";
import type { ModuleTree, WorkItem } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
} from "../generated/workItems.documents";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "../generated/workItems.documents";
import {
  moduleTreeFromWorkItems,
  readModuleTreeRecords,
  readProjectWorkItems,
  readWorkItem,
} from "./readTransport";
import { orderedWorkItems, workItemFromIssue } from "../issueAdapter";

export const EMPTY_MODULE_TREE: ModuleTree = {
  rootIds: [],
  children: {},
  order: [],
};

const issueReference = (id: string) => ({
  __typename: "WorktrackerIssue" as const,
  id: compactWorktrackerId(id),
});

const recordSelectionProfilePoint = (point: string) => {
  (globalThis as typeof globalThis & {
    __ticketrySelectionProfileProbe?: (point: string) => void;
  }).__ticketrySelectionProfileProbe?.(point);
};

function moduleTreeFromResult(
  moduleId: string,
  rows: readonly GeneratedWorkTrackerWorkItemFieldsFragment[],
): ModuleTree {
  return moduleTreeFromWorkItems(moduleId, orderedWorkItems(rows));
}

export function getModuleTreeSnapshot(
  _projectId: string | null,
  moduleId: string | null,
): ModuleTree {
  if (!moduleId) return EMPTY_MODULE_TREE;
  const result = studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId: compactWorktrackerId(moduleId) },
    optimistic: true,
  });
  return result
    ? moduleTreeFromResult(moduleId, result.work_items.nodes)
    : EMPTY_MODULE_TREE;
}

export async function loadModuleTree(
  projectId: string,
  moduleId: string,
): Promise<ModuleTree> {
  const { workItems: _workItems, ...tree } = await readModuleTreeRecords(
    projectId,
    moduleId,
  );
  return tree;
}

export function useModuleTree(
  _projectId: string | null,
  moduleId: string | null,
): ModuleTree {
  return useModuleOpen(moduleId).tree;
}

export function useModuleOpen(moduleId: string | null): {
  tree: ModuleTree;
  items: WorkItem[];
  loading: boolean;
} {
  recordSelectionProfilePoint("module-open-hook");
  const query = useQuery(
    WorkTrackerModuleOpenDocument,
    moduleId
      ? {
          variables: { moduleId: compactWorktrackerId(moduleId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-and-network",
          nextFetchPolicy: "cache-first",
        }
      : skipToken,
  );
  const opened = useMemo(() => {
    if (!moduleId || !query.data) {
      return { tree: EMPTY_MODULE_TREE, items: [] };
    }
    const items = orderedWorkItems(query.data.work_items.nodes);
    recordSelectionProfilePoint("module-open-materialize");
    return {
      tree: moduleTreeFromWorkItems(moduleId, items),
      items,
    };
  }, [moduleId, query.data]);
  return { ...opened, loading: query.loading };
}

/** Subscribe to the normalized Apollo row for one work item. */
export function useWorkItem(id: string | null) {
  const fragment = useFragment({
    client: studioApolloClient(),
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: id ? issueReference(id) : null,
  });
  const data = id && fragment.data && "id" in fragment.data
    ? workItemFromIssue(fragment.data as GeneratedWorkTrackerWorkItemFieldsFragment)
    : undefined;
  return {
    data,
    isPending: Boolean(id) && !fragment.complete,
    isLoading: Boolean(id) && !fragment.complete,
    error: undefined as Error | undefined,
  };
}

export function getWorkItemSnapshot(id: string | null): WorkItem | undefined {
  if (!id) return undefined;
  const row = studioApolloClient().readFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    from: issueReference(id),
    optimistic: true,
  });
  return row ? workItemFromIssue(row) : undefined;
}

export { readProjectWorkItems, readWorkItem };
export { useWorkItemAttachments } from "./useWorkItemAttachments";
