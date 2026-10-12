import type { WorkItem, WorkItemCreate } from "../../shared/api/types";
import { executeDeclaredMutation } from "../../shared/apollo/declaredMutation";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";
import { workItemBlockersMutation } from "./internal/workItemBlockersMutation";
import { workItemCreationMutation } from "./internal/workItemCreationMutation";
import { workItemDeletionMutation } from "./internal/workItemDeletionMutation";
import {
  workItemDetailsMutation,
  type WorkItemDetailsPatch,
} from "./internal/workItemDetailsMutation";
import { workItemReorderMutation } from "./internal/workItemReorderMutation";
import { workItemReparentMutation } from "./internal/workItemReparentMutation";
import { workItemTransitionMutation } from "./internal/workItemTransitionMutation";

export interface WorkItemWriteOptions {
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
  moduleId?: string;
  moduleIds?: readonly string[];
}

export function createWorkItem(
  projectId: string,
  body: WorkItemCreate,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const issueTypeId = body.issue_type_id;
  if (!issueTypeId) return Promise.reject(new Error("A work-item type is required."));
  return executeDeclaredMutation(workItemCreationMutation, {
    projectId,
    body: { ...body, issue_type_id: issueTypeId },
    moduleId: options.moduleId,
    optimistic: options.optimistic,
  });
}

export function updateWorkItem(
  id: string,
  patch: WorkItemDetailsPatch,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  return executeDeclaredMutation(workItemDetailsMutation, {
    id,
    patch,
    optimistic: options.optimistic,
  });
}

export function transitionWorkItem(
  id: string,
  stateId: string,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  return executeDeclaredMutation(workItemTransitionMutation, {
    id,
    stateId,
    moduleId: options.moduleId,
    optimistic: options.optimistic,
  });
}

export function reparentWorkItem(
  id: string,
  parentId: string | null,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  return executeDeclaredMutation(workItemReparentMutation, {
    id,
    parentId,
    moduleIds: [options.moduleId, ...(options.moduleIds ?? [])],
    optimistic: options.optimistic,
  });
}

export function setWorkItemBlockers(
  id: string,
  blockedByIds: string[],
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  return executeDeclaredMutation(workItemBlockersMutation, {
    id,
    blockedByIds,
    moduleId: options.moduleId,
    optimistic: options.optimistic,
  });
}

export function reorderWorkItem(
  id: string,
  neighbors: {
    before_id: string | null;
    after_id: string | null;
    initial_order_ids?: string[] | null;
  },
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  return executeDeclaredMutation(workItemReorderMutation, {
    id,
    beforeId: neighbors.before_id,
    afterId: neighbors.after_id,
    initialOrderIds: neighbors.initial_order_ids,
    moduleId: options.moduleId,
    optimistic: options.optimistic,
  });
}

export function deleteWorkItem(
  id: string,
  options: WorkItemWriteOptions = {},
): Promise<void> {
  return executeDeclaredMutation(workItemDeletionMutation, {
    id,
    moduleIds: [options.moduleId, ...(options.moduleIds ?? [])],
  });
}
