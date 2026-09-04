import type { WorkItem, WorkItemCreate } from "../../shared/api/types";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
  ReorderWorkTrackerWorkItemDocument,
  ReparentWorkTrackerWorkItemDocument,
  SetWorkTrackerBlockersDocument,
  TransitionWorkTrackerWorkItemDocument,
  UpdateWorkTrackerWorkItemDocument,
  WorkTrackerModuleOpenDocument,
} from "./generated/workItems.documents";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";
import { workItemFromIssue } from "./issueAdapter";
import {
  recordStoryMove,
  storyMoveError,
} from "./internal/storyMoveDiagnostics";

export interface WorkItemWriteOptions {
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
  moduleId?: string;
}

export async function createWorkItem(
  projectId: string,
  body: WorkItemCreate,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const issueTypeId = body.issue_type_id;
  if (!issueTypeId) throw new Error("A work-item type is required.");
  const { data } = await studioApolloClient().mutate({
    mutation: CreateWorkTrackerWorkItemDocument,
    variables: {
      projectId: compactWorktrackerId(projectId),
      name: body.name ?? "",
      issueTypeId: compactWorktrackerId(issueTypeId),
      description: body.description,
      stateId: body.state_id ? compactWorktrackerId(body.state_id) : body.state_id,
      parentId: body.parent_id ? compactWorktrackerId(body.parent_id) : body.parent_id,
    },
    optimisticResponse: options.optimistic
      ? { create_work_item: options.optimistic }
      : undefined,
    update(cache, result) {
      if (!options.moduleId || !result.data?.create_work_item) return;
      const variables = { moduleId: compactWorktrackerId(options.moduleId) };
      cache.updateQuery({ query: WorkTrackerModuleOpenDocument, variables }, (current) => {
        if (!current) return current;
        const created = result.data!.create_work_item;
        return {
          ...current,
          work_items: {
            ...current.work_items,
            nodes: [
              ...current.work_items.nodes.filter((row) =>
                row.id !== created.id && !row.id.startsWith("optimistic:")
              ),
              created,
            ],
          },
        };
      });
    },
    refetchQueries: options.moduleId ? [WorkTrackerModuleOpenDocument] : [],
    awaitRefetchQueries: Boolean(options.moduleId),
  });
  return workItemFromIssue(data!.create_work_item);
}

export async function updateWorkItem(
  id: string,
  patch: { name?: string; description?: string | null; issue_type_id?: string },
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: UpdateWorkTrackerWorkItemDocument,
    variables: {
      id: compactWorktrackerId(id),
      name: patch.name,
      description: patch.description,
      issueTypeId: patch.issue_type_id ? compactWorktrackerId(patch.issue_type_id) : undefined,
    },
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  return workItemFromIssue(data!.update_work_item);
}

export async function transitionWorkItem(
  id: string,
  stateId: string,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const client = studioApolloClient();
  const variables = {
    id: compactWorktrackerId(id),
    targetStateId: compactWorktrackerId(stateId),
  };
  recordStoryMove("transition-requested", {
    ...variables,
    optimistic: Boolean(options.optimistic),
  });
  try {
    const { data } = await client.mutate({
      mutation: TransitionWorkTrackerWorkItemDocument,
      variables,
      optimisticResponse: options.optimistic
        ? { update_work_item: options.optimistic }
        : undefined,
    });
    const item = workItemFromIssue(data!.update_work_item);
    recordStoryMove("transition-succeeded", {
      id: item.id,
      stateId: item.state,
      rank: item.rank,
    });
    if (options.moduleId) {
      await client.query({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(options.moduleId) },
        fetchPolicy: "network-only",
      });
    }
    return item;
  } catch (error) {
    recordStoryMove("transition-failed", {
      ...variables,
      error: storyMoveError(error),
    }, "error");
    throw error;
  }
}

export async function reparentWorkItem(
  id: string,
  parentId: string | null,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: ReparentWorkTrackerWorkItemDocument,
    variables: {
      id: compactWorktrackerId(id),
      parentId: parentId ? compactWorktrackerId(parentId) : null,
    },
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
    refetchQueries: [WorkTrackerModuleOpenDocument],
    awaitRefetchQueries: true,
  });
  return workItemFromIssue(data!.update_work_item);
}

export async function setWorkItemBlockers(
  id: string,
  blockedByIds: string[],
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: SetWorkTrackerBlockersDocument,
    variables: {
      id: compactWorktrackerId(id),
      blockedByIds: blockedByIds.map(compactWorktrackerId),
    },
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  return workItemFromIssue(data!.update_work_item);
}

export async function reorderWorkItem(
  id: string,
  neighbors: {
    before_id: string | null;
    after_id: string | null;
    initial_order_ids?: string[] | null;
  },
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const client = studioApolloClient();
  const variables = {
    id: compactWorktrackerId(id),
    beforeId: neighbors.before_id ? compactWorktrackerId(neighbors.before_id) : null,
    afterId: neighbors.after_id ? compactWorktrackerId(neighbors.after_id) : null,
    initialOrderIds: neighbors.initial_order_ids?.map(compactWorktrackerId),
  };
  let phase = "mutation";
  recordStoryMove("reorder-requested", {
    ...variables,
    moduleId: options.moduleId ?? null,
    optimistic: Boolean(options.optimistic),
  });
  try {
    const { data } = await client.mutate({
      mutation: ReorderWorkTrackerWorkItemDocument,
      variables,
      optimisticResponse: options.optimistic
        ? { reorder_work_item: options.optimistic }
        : undefined,
    });
    const item = workItemFromIssue(data!.reorder_work_item);
    recordStoryMove("reorder-mutation-succeeded", {
      id: item.id,
      stateId: item.state,
      rank: item.rank,
    });
    // Rebalancing can change every sibling rank. Fetch this exact module instead
    // of relying on Apollo to discover an active query from the document alone.
    if (options.moduleId) {
      phase = "module-refresh";
      await client.query({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(options.moduleId) },
        fetchPolicy: "network-only",
      });
      recordStoryMove("reorder-refresh-succeeded", {
        id: item.id,
        moduleId: options.moduleId,
      });
    }
    return item;
  } catch (error) {
    recordStoryMove("reorder-failed", {
      ...variables,
      moduleId: options.moduleId ?? null,
      phase,
      error: storyMoveError(error),
    }, "error");
    throw error;
  }
}

export async function deleteWorkItem(id: string): Promise<void> {
  const client = studioApolloClient();
  await client.mutate({
    mutation: DeleteWorkTrackerWorkItemDocument,
    variables: { id: compactWorktrackerId(id) },
    optimisticResponse: { delete_work_item: true },
    update(cache) {
      cache.evict({
        id: cache.identify({
          __typename: "WorktrackerIssue",
          id: compactWorktrackerId(id),
        }),
      });
    },
    refetchQueries: [WorkTrackerModuleOpenDocument],
    awaitRefetchQueries: true,
  });
  client.cache.gc();
}
