import type { WorkItem } from "./workItemView";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  UpdateWorkTrackerWorkItemDetailsDocument,
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
  ReorderWorkTrackerWorkItemDocument,
  ReparentWorkTrackerWorkItemDocument,
  SetWorkTrackerBlockersDocument,
  TransitionWorkTrackerWorkItemDocument,
  WorkTrackerModuleOpenDocument,
} from "./generated/workItems.documents";
import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import type {
  CreateWorkTrackerWorkItemMutationVariables,
  UpdateWorkTrackerWorkItemDetailsMutationVariables,
  TransitionWorkTrackerWorkItemMutationVariables,
  ReparentWorkTrackerWorkItemMutationVariables,
  SetWorkTrackerBlockersMutationVariables,
  ReorderWorkTrackerWorkItemMutationVariables,
  DeleteWorkTrackerWorkItemMutationVariables,
  GeneratedWorkTrackerWorkItemFieldsFragment,
} from "./generated/workItems.documents";
import { workItemView } from "./workItemView";
import {
  recordStoryMove,
  storyMoveError,
} from "./internal/storyMoveDiagnostics";
import { recordLocalWorkItemConvergence } from "./workItemConvergence";

export interface WorkItemWriteOptions {
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
  moduleId?: string;
  moduleIds?: readonly string[];
}

function affectedModuleIds(options: WorkItemWriteOptions): string[] {
  return [...new Set(
    [options.moduleId, ...(options.moduleIds ?? [])]
      .filter((id): id is string => Boolean(id))
      .map((moduleId) => serverVariables(WorkTrackerModuleOpenDocument, { moduleId }).moduleId),
  )];
}

async function refreshModuleLists(options: WorkItemWriteOptions): Promise<void> {
  const client = studioApolloClient();
  await Promise.all(affectedModuleIds(options).map((moduleId) =>
    client.query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId },
      fetchPolicy: "network-only",
    })));
}

export async function createWorkItem(
  input: CreateWorkTrackerWorkItemMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  if (!input.issueTypeId) throw new Error("A work-item type is required.");
  const { data } = await studioApolloClient().mutate({
    mutation: CreateWorkTrackerWorkItemDocument,
    variables: serverVariables(CreateWorkTrackerWorkItemDocument, input),
    optimisticResponse: options.optimistic
      ? { create_work_item: options.optimistic }
      : undefined,
    update(cache, result) {
      if (!options.moduleId || !result.data?.create_work_item) return;
      const variables = serverVariables(WorkTrackerModuleOpenDocument, { moduleId: options.moduleId });
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
  });
  await refreshModuleLists(options);
  recordLocalWorkItemConvergence(data!.create_work_item.id, data!.create_work_item.updated_at);
  return workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.create_work_item));
}

export async function updateWorkItem(
  input: UpdateWorkTrackerWorkItemDetailsMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: UpdateWorkTrackerWorkItemDetailsDocument,
    variables: serverVariables(UpdateWorkTrackerWorkItemDetailsDocument, input),
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  recordLocalWorkItemConvergence(data!.update_work_item.id, data!.update_work_item.updated_at);
  return workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.update_work_item));
}

export async function transitionWorkItem(
  input: TransitionWorkTrackerWorkItemMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const client = studioApolloClient();
  const variables = serverVariables(TransitionWorkTrackerWorkItemDocument, input);
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
    const item = workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.update_work_item));
    recordStoryMove("transition-succeeded", {
      id: item.id,
      stateId: item.state_id,
      rank: item.rank,
    });
    if (options.moduleId) {
      await client.query({
        query: WorkTrackerModuleOpenDocument,
        variables: serverVariables(WorkTrackerModuleOpenDocument, { moduleId: options.moduleId }),
        fetchPolicy: "network-only",
      });
    }
    recordLocalWorkItemConvergence(data!.update_work_item.id, data!.update_work_item.updated_at);
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
  input: ReparentWorkTrackerWorkItemMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: ReparentWorkTrackerWorkItemDocument,
    variables: serverVariables(ReparentWorkTrackerWorkItemDocument, input),
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  await refreshModuleLists({
    ...options,
    moduleIds: [...(options.moduleIds ?? []), data!.update_work_item.module_id ?? ""],
  });
  recordLocalWorkItemConvergence(data!.update_work_item.id, data!.update_work_item.updated_at);
  return workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.update_work_item));
}

export async function setWorkItemBlockers(
  input: SetWorkTrackerBlockersMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const { data } = await studioApolloClient().mutate({
    mutation: SetWorkTrackerBlockersDocument,
    variables: serverVariables(SetWorkTrackerBlockersDocument, input),
    optimisticResponse: options.optimistic
      ? { update_work_item: options.optimistic }
      : undefined,
  });
  await refreshModuleLists(options);
  recordLocalWorkItemConvergence(data!.update_work_item.id, data!.update_work_item.updated_at);
  return workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.update_work_item));
}

export async function reorderWorkItem(
  input: ReorderWorkTrackerWorkItemMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<WorkItem> {
  const client = studioApolloClient();
  const variables = serverVariables(ReorderWorkTrackerWorkItemDocument, input);
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
    const item = workItemView(publicResult(GeneratedWorkTrackerWorkItemFieldsFragmentDoc, data!.reorder_work_item));
    recordStoryMove("reorder-mutation-succeeded", {
      id: item.id,
      stateId: item.state_id,
      rank: item.rank,
    });
    // Rebalancing can change every sibling rank. Fetch this exact module instead
    // of relying on Apollo to discover an active query from the document alone.
    if (options.moduleId) {
      phase = "module-refresh";
      await client.query({
        query: WorkTrackerModuleOpenDocument,
        variables: serverVariables(WorkTrackerModuleOpenDocument, { moduleId: options.moduleId }),
        fetchPolicy: "network-only",
      });
      recordStoryMove("reorder-refresh-succeeded", {
        id: item.id,
        moduleId: options.moduleId,
      });
    }
    recordLocalWorkItemConvergence(data!.reorder_work_item.id, data!.reorder_work_item.updated_at);
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

export async function deleteWorkItem(
  input: DeleteWorkTrackerWorkItemMutationVariables,
  options: WorkItemWriteOptions = {},
): Promise<void> {
  const client = studioApolloClient();
  const variables = serverVariables(DeleteWorkTrackerWorkItemDocument, input);
  await client.mutate({
    mutation: DeleteWorkTrackerWorkItemDocument,
    variables,
    optimisticResponse: { delete_work_item: true },
    update(cache) {
      cache.evict({
        id: cache.identify({
          __typename: "WorktrackerIssue",
          id: variables.id,
        }),
      });
    },
  });
  await refreshModuleLists(options);
  client.cache.gc();
}
