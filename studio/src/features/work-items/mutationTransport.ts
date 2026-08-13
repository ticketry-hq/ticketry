import { studioRuntime } from "../../runtime";
import * as rest from "../../shared/api/client";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type { WorkItem, WorkItemCreate } from "../../shared/api/types";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
  ReorderWorkTrackerWorkItemDocument,
  ReparentWorkTrackerWorkItemDocument,
  SetWorkTrackerBlockersDocument,
  TransitionWorkTrackerWorkItemDocument,
  UpdateWorkTrackerWorkItemDocument,
} from "./generated/mutations";

async function graphQl<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    return graphQlMutationError(error);
  }
}

export function createWorkItem(projectId: string, body: WorkItemCreate): Promise<WorkItem> {
  const issueTypeId = body.issue_type_id;
  if (!issueTypeId) {
    return Promise.reject(new Error("A work-item type is required."));
  }
  return studioRuntime().writeWorkTracker({
    rest: () => rest.createWorkItem(projectId, body),
    graphQl: (execute) => graphQl(async () => (await execute(
      CreateWorkTrackerWorkItemDocument,
      {
        projectId,
        name: body.name ?? "",
        issueTypeId,
        description: body.description,
        stateId: body.state_id,
        parentId: body.parent_id,
      },
    )).create_work_item as WorkItem),
  });
}

export function updateWorkItem(
  id: string,
  patch: { name?: string; description?: string | null; issue_type_id?: string },
): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, patch),
    graphQl: (execute) => graphQl(async () => (await execute(
      UpdateWorkTrackerWorkItemDocument,
      { id, name: patch.name, description: patch.description, issueTypeId: patch.issue_type_id },
    )).update_work_item as WorkItem),
  });
}

export function transitionWorkItem(id: string, stateId: string): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { state_id: stateId }),
    graphQl: (execute) => graphQl(async () => (await execute(
      TransitionWorkTrackerWorkItemDocument,
      { id, targetStateId: stateId },
    )).transition_work_item as WorkItem),
  });
}

export function reparentWorkItem(id: string, parentId: string | null): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { parent_id: parentId }),
    graphQl: (execute) => graphQl(async () => (await execute(
      ReparentWorkTrackerWorkItemDocument,
      { id, parentId },
    )).reparent_work_item as WorkItem),
  });
}

export function setWorkItemBlockers(id: string, blockedByIds: string[]): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { blocked_by_ids: blockedByIds }),
    graphQl: (execute) => graphQl(async () => (await execute(
      SetWorkTrackerBlockersDocument,
      { id, blockedByIds },
    )).set_work_item_blockers as WorkItem),
  });
}

export function reorderWorkItem(
  id: string,
  neighbors: { before_id: string | null; after_id: string | null; initial_order_ids?: string[] | null },
): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.reorderWorkItem(id, neighbors),
    graphQl: (execute) => graphQl(async () => (await execute(
      ReorderWorkTrackerWorkItemDocument,
      {
        id,
        beforeId: neighbors.before_id,
        afterId: neighbors.after_id,
        initialOrderIds: neighbors.initial_order_ids,
      },
    )).reorder_work_item as WorkItem),
  });
}

export function deleteWorkItem(id: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.deleteWorkItem(id),
    graphQl: (execute) => graphQl(async () => {
      await execute(DeleteWorkTrackerWorkItemDocument, { id });
    }),
  });
}
