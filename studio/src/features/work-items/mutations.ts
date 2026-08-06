import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import type {
  IssueType,
  State,
  WorkItem,
  WorkItemCreate,
} from "../../shared/api/types";
import { queryKeys } from "../../shared/query/keys";
import { rankBetween } from "./utilities/rank";

export interface ModuleMembership {
  projectId: string;
  moduleId: string;
}

interface MutationContext {
  id: string | null;
  previous: WorkItem | undefined;
  relatedIds: string[];
}

interface OptimisticMutation<TVariables> {
  mutationFn: (variables: TVariables) => Promise<WorkItem>;
  id: (variables: TVariables) => string | null;
  update?: (
    current: WorkItem,
    variables: TVariables,
    queryClient: QueryClient,
  ) => WorkItem;
  memberships?: readonly ModuleMembership[];
  relatedIds?: (
    variables: TVariables,
    previous: WorkItem | undefined,
  ) => readonly string[];
}

/**
 * The one work-item write sequence.
 *
 * TanStack Mutation owns the pre-write value in its onMutate result. Nothing
 * copies that baseline into a store or another cache entry. Writes with no id
 * yet (creation) use the same lifecycle but deliberately skip the optimistic
 * record update and wait for membership to be refreshed.
 */
function useOptimisticWorkItemMutation<TVariables>({
  mutationFn,
  id: mutationId,
  update,
  memberships = [],
  relatedIds = () => [],
}: OptimisticMutation<TVariables>) {
  const queryClient = useQueryClient();

  return useMutation<WorkItem, Error, TVariables, MutationContext>({
    mutationFn,

    async onMutate(variables) {
      const id = mutationId(variables);
      if (id === null) {
        return {
          id,
          previous: undefined,
          relatedIds: [...relatedIds(variables, undefined)],
        };
      }

      await queryClient.cancelQueries({
        queryKey: queryKeys.workItems.byId(id),
        exact: true,
      });
      const previous = queryClient.getQueryData<WorkItem>(
        queryKeys.workItems.byId(id),
      );
      if (previous && update) {
        queryClient.setQueryData(
          queryKeys.workItems.byId(id),
          update(previous, variables, queryClient),
        );
      }
      return {
        id,
        previous,
        relatedIds: [...relatedIds(variables, previous)],
      };
    },

    onError(_error, _variables, context) {
      if (context?.id && context.previous !== undefined) {
        queryClient.setQueryData(
          queryKeys.workItems.byId(context.id),
          context.previous,
        );
      }
    },

    onSuccess(authoritative, _variables, context) {
      // A response may reconcile only the entry that was mutated. Creation has
      // no such entry yet and is discovered through the refreshed membership.
      if (context.id && authoritative.id === context.id) {
        queryClient.setQueryData(
          queryKeys.workItems.byId(context.id),
          authoritative,
        );
      }
    },

    async onSettled(_data, _error, _variables, context) {
      const invalidations: Promise<unknown>[] = [];
      if (context?.id) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.workItems.byId(context.id),
            exact: true,
          }),
        );
      }
      for (const relatedId of new Set(context?.relatedIds ?? [])) {
        if (relatedId === context?.id) continue;
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.workItems.byId(relatedId),
            exact: true,
          }),
        );
      }
      for (const membership of memberships) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.tasks.byModule(
              membership.projectId,
              membership.moduleId,
            ),
            exact: true,
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}

export interface RenameWorkItemArgs {
  id: string;
  name: string;
}

export function useRenameWorkItem() {
  return useOptimisticWorkItemMutation<RenameWorkItemArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, name }) => api.patchWorkItem(id, { name }),
    update: (current, { name }) => ({ ...current, name }),
  });
}

export interface EditWorkItemDescriptionArgs {
  id: string;
  description: string | null;
}

export function useEditWorkItemDescription() {
  return useOptimisticWorkItemMutation<EditWorkItemDescriptionArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, description }) =>
      api.patchWorkItem(id, { description }),
    update: (current, { description }) => ({ ...current, description }),
  });
}

export interface ChangeWorkItemTypeArgs {
  id: string;
  issueType: IssueType;
}

export function useChangeWorkItemType() {
  return useOptimisticWorkItemMutation<ChangeWorkItemTypeArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, issueType }) =>
      api.patchWorkItem(id, { issue_type_id: issueType.id }),
    update: (current, { issueType }) => ({
      ...current,
      issue_type: issueType,
    }),
  });
}

export interface SetWorkItemStateArgs {
  id: string;
  state: State & { id: string };
}

export function useSetWorkItemState() {
  return useOptimisticWorkItemMutation<SetWorkItemStateArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, state }) =>
      api.patchWorkItem(id, { state_id: state.id }),
    update: (current, { state }) => ({ ...current, state }),
  });
}

export interface SetWorkItemParentArgs {
  id: string;
  parentId: string | null;
}

export function useSetWorkItemParent(
  memberships: readonly ModuleMembership[],
) {
  return useOptimisticWorkItemMutation<SetWorkItemParentArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, parentId }) =>
      api.patchWorkItem(id, { parent_id: parentId }),
    update: (current, { parentId }) => ({
      ...current,
      parent_id: parentId,
    }),
    memberships,
  });
}

export interface SetWorkItemBlockersArgs {
  id: string;
  blockedByIds: string[];
}

export function useSetWorkItemBlockers() {
  return useOptimisticWorkItemMutation<SetWorkItemBlockersArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, blockedByIds }) =>
      api.patchWorkItem(id, { blocked_by_ids: blockedByIds }),
    update: (current, { blockedByIds }) => ({
      ...current,
      blocked_by_ids: blockedByIds,
    }),
    relatedIds: ({ blockedByIds }, previous) => [
      ...(previous?.blocked_by_ids ?? []),
      ...blockedByIds,
    ],
  });
}

export interface ReorderWorkItemArgs {
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

function cachedRank(
  queryClient: QueryClient,
  id: string | null,
): string | null {
  if (id === null) return null;
  const rank = queryClient.getQueryData<WorkItem>(
    queryKeys.workItems.byId(id),
  )?.rank;
  if (rank === undefined) {
    throw new Error(`Cannot optimistically reorder without rank for ${id}`);
  }
  return rank;
}

export function useReorderWorkItem(
  membership: ModuleMembership,
) {
  return useOptimisticWorkItemMutation<ReorderWorkItemArgs>({
    id: ({ id }) => id,
    mutationFn: ({ id, beforeId, afterId }) =>
      api.reorderWorkItem(id, {
        before_id: beforeId,
        after_id: afterId,
      }),
    update: (current, { beforeId, afterId }, queryClient) => ({
      ...current,
      rank: rankBetween(
        cachedRank(queryClient, beforeId),
        cachedRank(queryClient, afterId),
      ),
    }),
    memberships: [membership],
  });
}

export function useCreateWorkItem(
  membership: ModuleMembership,
) {
  return useOptimisticWorkItemMutation<WorkItemCreate>({
    id: () => null,
    mutationFn: (body) => api.createWorkItem(membership.projectId, body),
    memberships: [membership],
  });
}
