import { studioRuntime } from "../../runtime";
import * as rest from "../../shared/api/client";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import type { WorkItem, WorkItemCreate } from "../../shared/api/types";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
  ReorderWorkTrackerWorkItemDocument,
  ReparentWorkTrackerWorkItemDocument,
  SetWorkTrackerBlockersDocument,
  TransitionWorkTrackerWorkItemDocument,
  UpdateWorkTrackerWorkItemDocument,
} from "./generated/mutations";
import { workItemFromIssue } from "./issueAdapter";

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
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      CreateWorkTrackerWorkItemDocument,
      {
        projectId: compactWorktrackerId(projectId),
        name: body.name ?? "",
        issueTypeId: compactWorktrackerId(issueTypeId),
        description: body.description,
        stateId: body.state_id ? compactWorktrackerId(body.state_id) : body.state_id,
        parentId: body.parent_id ? compactWorktrackerId(body.parent_id) : body.parent_id,
      },
    )).create_work_item)),
  });
}

export function updateWorkItem(
  id: string,
  patch: { name?: string; description?: string | null; issue_type_id?: string },
): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, patch),
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      UpdateWorkTrackerWorkItemDocument,
      { id: compactWorktrackerId(id), name: patch.name, description: patch.description, issueTypeId: patch.issue_type_id ? compactWorktrackerId(patch.issue_type_id) : undefined },
    )).update_work_item)),
  });
}

export function transitionWorkItem(id: string, stateId: string): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { state_id: stateId }),
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      TransitionWorkTrackerWorkItemDocument,
      { id: compactWorktrackerId(id), targetStateId: compactWorktrackerId(stateId) },
    )).update_work_item)),
  });
}

export function reparentWorkItem(id: string, parentId: string | null): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { parent_id: parentId }),
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      ReparentWorkTrackerWorkItemDocument,
      { id: compactWorktrackerId(id), parentId: parentId ? compactWorktrackerId(parentId) : null },
    )).update_work_item)),
  });
}

export function setWorkItemBlockers(id: string, blockedByIds: string[]): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.patchWorkItem(id, { blocked_by_ids: blockedByIds }),
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      SetWorkTrackerBlockersDocument,
      { id: compactWorktrackerId(id), blockedByIds: blockedByIds.map(compactWorktrackerId) },
    )).update_work_item)),
  });
}

export function reorderWorkItem(
  id: string,
  neighbors: { before_id: string | null; after_id: string | null; initial_order_ids?: string[] | null },
): Promise<WorkItem> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.reorderWorkItem(id, neighbors),
    graphQl: (execute) => graphQl(async () => workItemFromIssue((await execute(
      ReorderWorkTrackerWorkItemDocument,
      {
        id: compactWorktrackerId(id),
        beforeId: neighbors.before_id ? compactWorktrackerId(neighbors.before_id) : null,
        afterId: neighbors.after_id ? compactWorktrackerId(neighbors.after_id) : null,
        initialOrderIds: neighbors.initial_order_ids?.map(compactWorktrackerId),
      },
    )).reorder_work_item)),
  });
}

export function deleteWorkItem(id: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    rest: () => rest.deleteWorkItem(id),
    graphQl: (execute) => graphQl(async () => {
      await execute(DeleteWorkTrackerWorkItemDocument, { id: compactWorktrackerId(id) });
    }),
  });
}
