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
import { recordSelectionProfilePoint } from "../../../shared/utilities/selectionProfile";

import { moduleLoadPoint } from "../../../shared/utilities/moduleLoadProbe";

export const EMPTY_MODULE_TREE: ModuleTree = {
  rootIds: [],
  children: {},
  order: [],
};

const issueReference = (id: string) => ({
  __typename: "WorktrackerIssue" as const,
  id: compactWorktrackerId(id),
});

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
  const query = useModuleQuery(moduleId);
  const opened = useMemo(() => {
    if (!moduleId || !query.data) {
      return { tree: EMPTY_MODULE_TREE, items: [] };
    }
    const started = performance.now();
    const items = orderedWorkItems(query.data.work_items.nodes).filter((item) => !item.is_archived);
    recordSelectionProfilePoint("module-open-materialize");
    const tree = moduleTreeFromWorkItems(moduleId, items);
    moduleLoadPoint(moduleId)("tree-materialized", { task_count: items.length, materialize_ms: performance.now() - started });
    return { tree, items };
  }, [moduleId, query.data]);
  return { ...opened, loading: query.loading };
}

function useModuleQuery(moduleId: string | null, fetchPolicy: "cache-and-network" | "cache-only" = "cache-and-network") {
  return useQuery(
    WorkTrackerModuleOpenDocument,
    moduleId
      ? {
          variables: { moduleId: compactWorktrackerId(moduleId) },
          client: studioApolloClient(),
          fetchPolicy,
          nextFetchPolicy: fetchPolicy === "cache-only" ? "cache-only" : "cache-first",
        }
      : skipToken,
  );
}

/** Dialog candidates use the central fetch's cache without building a hierarchy. */
export function useModuleItems(moduleId: string | null) {
  const { data } = useModuleQuery(moduleId, "cache-only");
  return useMemo(() => data
    ? orderedWorkItems(data.work_items.nodes).filter((item) => !item.is_archived)
    : [], [data]);
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
