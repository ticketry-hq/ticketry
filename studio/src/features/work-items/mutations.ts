import type { WorkItem } from "./workItemView";
import { useCallback, useState } from "react";
import type { WorkItemCreateVariables } from "./types";
import type { IssueType, State } from "../workflows";
import { studioApolloClient } from "../../shared/apollo/client";
import type {
  GeneratedWorkTrackerWorkItemFieldsFragment,
  UpdateWorkTrackerWorkItemDetailsMutationVariables,
  ReparentWorkTrackerWorkItemMutationVariables,
  SetWorkTrackerBlockersMutationVariables,
  ReorderWorkTrackerWorkItemMutationVariables,
  TransitionWorkTrackerWorkItemMutationVariables,
} from "./generated/workItems.documents";
import { rankBetween } from "./utilities/rank";
import { cachedIssue, cachedModuleIssue } from "./internal/mutationCache";
import { optimisticIssueType, optimisticParent, optimisticBlockers } from "./internal/optimisticUpdates";
import {
  createWorkItem,
  reparentWorkItem,
  reorderWorkItem,
  setWorkItemBlockers,
  transitionWorkItem,
  updateWorkItem,
} from "./mutationTransport";
import {
  recordStoryMove,
  storyMoveError,
} from "./internal/storyMoveDiagnostics";
import { optimisticCreatedIssue } from "./internal/optimisticCreation";
import { optimisticTransitionedIssue } from "./internal/optimisticTransition";

export interface ModuleMembership {
  projectId: string;
  moduleId: string;
}

interface MutationCallbacks<TResult> {
  onSuccess?: (data: TResult) => void;
  onError?: (error: Error) => void;
  onSettled?: (data: TResult | undefined, error: Error | null) => void;
}

type OptimisticIssue<TVariables> = (
  current: GeneratedWorkTrackerWorkItemFieldsFragment,
  variables: TVariables,
) => GeneratedWorkTrackerWorkItemFieldsFragment;

function useApolloWorkItemMutation<TVariables>(
  execute: (
    variables: TVariables,
    optimistic: GeneratedWorkTrackerWorkItemFieldsFragment | undefined,
  ) => Promise<WorkItem>,
  identity: (variables: TVariables) => string | null,
  update?: OptimisticIssue<TVariables>,
  readCurrent?: (variables: TVariables) => GeneratedWorkTrackerWorkItemFieldsFragment | undefined,
) {
  const [pendingCount, setPendingCount] = useState(0);
  const [variables, setVariables] = useState<TVariables>();
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const mutateAsync = useCallback(async (
    next: TVariables,
    callbacks: MutationCallbacks<WorkItem> = {},
  ): Promise<WorkItem> => {
    setPendingCount((count) => count + 1);
    setVariables(next);
    setError(null);
    setIsSuccess(false);
    const id = identity(next);
    const current = readCurrent?.(next) ?? (id ? cachedIssue(id) : undefined);
    const optimistic = current && update ? update(current, next) : undefined;
    try {
      const result = await execute(next, optimistic);
      setIsSuccess(true);
      callbacks.onSuccess?.(result);
      callbacks.onSettled?.(result, null);
      return result;
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      setError(failure);
      callbacks.onError?.(failure);
      callbacks.onSettled?.(undefined, failure);
      throw failure;
    } finally {
      setPendingCount((count) => Math.max(0, count - 1));
    }
  }, [execute, identity, readCurrent, update]);

  const mutate = useCallback((
    next: TVariables,
    callbacks: MutationCallbacks<WorkItem> = {},
  ) => {
    void mutateAsync(next, callbacks).catch(() => undefined);
  }, [mutateAsync]);

  return {
    mutate,
    mutateAsync,
    isPending: pendingCount > 0,
    variables,
    error,
    isError: error !== null,
    isSuccess,
  };
}

export type RenameWorkItemArgs = Pick<UpdateWorkTrackerWorkItemDetailsMutationVariables, "id"> & Required<Pick<UpdateWorkTrackerWorkItemDetailsMutationVariables, "name">>;

export function useRenameWorkItem() {
  return useApolloWorkItemMutation(
    ({ id, name }: RenameWorkItemArgs, optimistic) =>
      updateWorkItem({ id, name }, { optimistic }),
    ({ id }: RenameWorkItemArgs) => id,
    (current, { name }) => ({ ...current, name: name ?? "" }),
  );
}

export type EditWorkItemDescriptionArgs = Pick<UpdateWorkTrackerWorkItemDetailsMutationVariables, "id"> & Required<Pick<UpdateWorkTrackerWorkItemDetailsMutationVariables, "description">>;

export function useEditWorkItemDescription() {
  return useApolloWorkItemMutation(
    ({ id, description }: EditWorkItemDescriptionArgs, optimistic) =>
      updateWorkItem({ id, description }, { optimistic }),
    ({ id }: EditWorkItemDescriptionArgs) => id,
    (current, { description }) => ({ ...current, description: description ?? "" }),
  );
}

export type ChangeWorkItemTypeArgs = Pick<UpdateWorkTrackerWorkItemDetailsMutationVariables, "id"> & { issueType: IssueType };

export function useChangeWorkItemType() {
  return useApolloWorkItemMutation(
    ({ id, issueType }: ChangeWorkItemTypeArgs, optimistic) =>
      updateWorkItem({ id, issueTypeId: issueType.id }, { optimistic }),
    ({ id }: ChangeWorkItemTypeArgs) => id,
    (current, { issueType }) => optimisticIssueType(current, issueType),
  );
}

export type SetWorkItemStateArgs = Pick<TransitionWorkTrackerWorkItemMutationVariables, "id"> & { state: State & { id: string } };

export function useSetWorkItemState() {
  return useApolloWorkItemMutation(
    ({ id, state }: SetWorkItemStateArgs, optimistic) =>
      transitionWorkItem({ id, targetStateId: state.id }, {
        optimistic,
        moduleId: optimistic?.module_id ?? undefined,
      }),
    ({ id }: SetWorkItemStateArgs) => id,
    (current, { state }) => optimisticTransitionedIssue(
      studioApolloClient().cache,
      current,
      state,
    ),
  );
}

export type SetWorkItemParentArgs = Pick<ReparentWorkTrackerWorkItemMutationVariables, "id"> & Required<Pick<ReparentWorkTrackerWorkItemMutationVariables, "parentId">> & { moduleId?: string };

export function useSetWorkItemParent(memberships: readonly ModuleMembership[]) {
  return useApolloWorkItemMutation(
    ({ id, parentId, moduleId }: SetWorkItemParentArgs, optimistic) =>
      reparentWorkItem({ id, parentId }, {
        optimistic,
        moduleIds: [
          ...memberships.map((membership) => membership.moduleId),
          ...(moduleId ? [moduleId] : []),
        ],
      }),
    ({ id }: SetWorkItemParentArgs) => id,
    (current, { parentId }) => optimisticParent(current, parentId),
  );
}

export type SetWorkItemBlockersArgs = SetWorkTrackerBlockersMutationVariables;

export function useSetWorkItemBlockers() {
  return useApolloWorkItemMutation(
    ({ id, blockedByIds }: SetWorkItemBlockersArgs, optimistic) =>
      setWorkItemBlockers({ id, blockedByIds }, {
        optimistic,
        moduleId: optimistic?.module_id ?? undefined,
      }),
    ({ id }: SetWorkItemBlockersArgs) => id,
    (current, { blockedByIds }) => optimisticBlockers(current, blockedByIds),
  );
}

export type ReorderWorkItemArgs = Pick<ReorderWorkTrackerWorkItemMutationVariables, "id"> & Required<Pick<ReorderWorkTrackerWorkItemMutationVariables, "beforeId" | "afterId">>;

function cachedRank(id: string | null | undefined): string | null {
  if (id == null) return null;
  const rank = cachedIssue(id)?.rank;
  if (rank === undefined) {
    throw new Error(`Cannot optimistically reorder without rank for ${id}`);
  }
  return rank;
}

export function useReorderWorkItem(membership: ModuleMembership) {
  return useApolloWorkItemMutation(
    ({ id, beforeId, afterId }: ReorderWorkItemArgs, optimistic) =>
      reorderWorkItem(
        { id, beforeId, afterId },
        { optimistic, moduleId: membership.moduleId },
      ),
    ({ id }: ReorderWorkItemArgs) => id,
    (current, { beforeId, afterId }) => {
      try {
        const beforeRank =
          beforeId ? cachedModuleIssue(membership, beforeId)?.rank ?? cachedRank(beforeId) : null;
        const afterRank =
          afterId ? cachedModuleIssue(membership, afterId)?.rank ?? cachedRank(afterId) : null;
        // Imported data can contain duplicate sibling ranks. The server repairs
        // that collision transactionally; skip only the optimistic move so the
        // authoritative reorder still reaches it.
        if (beforeRank !== null && beforeRank === afterRank) return current;
        return {
          ...current,
          rank: rankBetween(beforeRank, afterRank),
        };
      } catch (error) {
        recordStoryMove("optimistic-reorder-failed", {
          id: current.id,
          beforeId,
          afterId,
          moduleId: membership.moduleId,
          error: storyMoveError(error),
        }, "error");
        throw error;
      }
    },
    ({ id }) => cachedModuleIssue(membership, id),
  );
}

export function useCreateWorkItem(membership: ModuleMembership) {
  return useApolloWorkItemMutation(
    (body: WorkItemCreateVariables) => createWorkItem(
      { ...body, projectId: membership.projectId },
      {
        optimistic: optimisticCreatedIssue(studioApolloClient().cache, membership, body),
        moduleId: membership.moduleId,
      },
    ),
    () => null,
  );
}
