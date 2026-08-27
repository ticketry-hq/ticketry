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
    refetchQueries: [WorkTrackerModuleOpenDocument],
    awaitRefetchQueries: true,
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
  const { data } = await studioApolloClient().mutate({
    mutation: TransitionWorkTrackerWorkItemDocument,
    variables: {
      id: compactWorktrackerId(id),
      targetStateId: compactWorktrackerId(stateId),
    },
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  return workItemFromIssue(data!.update_work_item);
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
  const { data } = await studioApolloClient().mutate({
    mutation: ReorderWorkTrackerWorkItemDocument,
    variables: {
      id: compactWorktrackerId(id),
      beforeId: neighbors.before_id ? compactWorktrackerId(neighbors.before_id) : null,
      afterId: neighbors.after_id ? compactWorktrackerId(neighbors.after_id) : null,
      initialOrderIds: neighbors.initial_order_ids?.map(compactWorktrackerId),
    },
    optimisticResponse: options.optimistic
      ? { reorder_work_item: options.optimistic }
      : undefined,
    // A task reorder changes its module's task collection. Module reorders are
    // followed by the caller's authoritative ProjectOpen read instead.
    refetchQueries: options.moduleId ? [WorkTrackerModuleOpenDocument] : [],
    awaitRefetchQueries: true,
  });
  return workItemFromIssue(data!.reorder_work_item);
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
