import type { IssueType, State, WorkItem, WorkItemCreate } from "../../shared/api/types";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { useMutationState } from "../../shared/apollo/declaredMutation";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
} from "./generated/workItems.documents";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";
import { rankBetween } from "./utilities/rank";
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

type OptimisticIssue<TVariables> = (
  current: GeneratedWorkTrackerWorkItemFieldsFragment,
  variables: TVariables,
) => GeneratedWorkTrackerWorkItemFieldsFragment;

function cachedIssue(id: string): GeneratedWorkTrackerWorkItemFieldsFragment | undefined {
  const client = studioApolloClient();
  const cacheId = client.cache.identify({
    __typename: "WorktrackerIssue",
    id: compactWorktrackerId(id),
  });
  if (!cacheId) return undefined;
  return client.readFragment({
    id: cacheId,
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    optimistic: true,
  }) ?? undefined;
}

function useApolloWorkItemMutation<TVariables>(
  execute: (
    variables: TVariables,
    optimistic: GeneratedWorkTrackerWorkItemFieldsFragment | undefined,
  ) => Promise<WorkItem>,
  identity: (variables: TVariables) => string | null,
  update?: OptimisticIssue<TVariables>,
  readCurrent?: (variables: TVariables) => GeneratedWorkTrackerWorkItemFieldsFragment | undefined,
) {
  return useMutationState(execute, {
    current: (variables) => {
      const id = identity(variables);
      return readCurrent?.(variables) ?? (id ? cachedIssue(id) : undefined);
    },
    apply: update,
  });
}

export interface RenameWorkItemArgs { id: string; name: string }

export function useRenameWorkItem() {
  return useApolloWorkItemMutation(
    ({ id, name }: RenameWorkItemArgs, optimistic) =>
      updateWorkItem(id, { name }, { optimistic }),
    ({ id }: RenameWorkItemArgs) => id,
    (current, { name }) => ({ ...current, name }),
  );
}

export interface EditWorkItemDescriptionArgs { id: string; description: string | null }

export function useEditWorkItemDescription() {
  return useApolloWorkItemMutation(
    ({ id, description }: EditWorkItemDescriptionArgs, optimistic) =>
      updateWorkItem(id, { description }, { optimistic }),
    ({ id }: EditWorkItemDescriptionArgs) => id,
    (current, { description }) => ({ ...current, description: description ?? "" }),
  );
}

export interface ChangeWorkItemTypeArgs { id: string; issueType: IssueType }

export function useChangeWorkItemType() {
  return useApolloWorkItemMutation(
    ({ id, issueType }: ChangeWorkItemTypeArgs, optimistic) =>
      updateWorkItem(id, { issue_type_id: issueType.id }, { optimistic }),
    ({ id }: ChangeWorkItemTypeArgs) => id,
    (current, { issueType }) => ({
      ...current,
      issue_type_id: compactWorktrackerId(issueType.id),
      issue_type_record: {
        id: compactWorktrackerId(issueType.id),
        name: issueType.name,
        level: issueType.level,
        color: issueType.color ?? "",
        sort_order: issueType.sort_order,
      },
    }),
  );
}

export interface SetWorkItemStateArgs { id: string; state: State & { id: string } }

export function useSetWorkItemState() {
  return useApolloWorkItemMutation(
    ({ id, state }: SetWorkItemStateArgs, optimistic) =>
      transitionWorkItem(id, state.id, {
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

export interface SetWorkItemParentArgs {
  id: string;
  parentId: string | null;
  moduleId?: string;
}

export function useSetWorkItemParent(memberships: readonly ModuleMembership[]) {
  return useApolloWorkItemMutation(
    ({ id, parentId, moduleId }: SetWorkItemParentArgs, optimistic) =>
      reparentWorkItem(id, parentId, {
        optimistic,
        moduleIds: [
          ...memberships.map((membership) => membership.moduleId),
          ...(moduleId ? [moduleId] : []),
        ],
      }),
    ({ id }: SetWorkItemParentArgs) => id,
    (current, { parentId }) => ({
      ...current,
      parent_id: parentId ? compactWorktrackerId(parentId) : null,
    }),
  );
}

export interface SetWorkItemBlockersArgs { id: string; blockedByIds: string[] }

let optimisticBlockerEdgeSequence = 0;

export function useSetWorkItemBlockers() {
  return useApolloWorkItemMutation(
    ({ id, blockedByIds }: SetWorkItemBlockersArgs, optimistic) =>
      setWorkItemBlockers(id, blockedByIds, {
        optimistic,
        moduleId: optimistic?.module_id ?? undefined,
      }),
    ({ id }: SetWorkItemBlockersArgs) => id,
    (current, { blockedByIds }) => ({
      ...current,
      blocked_by_edges: {
        nodes: blockedByIds.map((id) => ({
          id: -(++optimisticBlockerEdgeSequence),
          to_issue_id: compactWorktrackerId(id),
        })),
      },
    }),
  );
}

export interface ReorderWorkItemArgs {
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

function cachedRank(id: string | null): string | null {
  if (id === null) return null;
  const rank = cachedIssue(id)?.rank;
  if (rank === undefined) {
    throw new Error(`Cannot optimistically reorder without rank for ${id}`);
  }
  return rank;
}

function cachedModuleIssue(
  membership: ModuleMembership,
  id: string,
): GeneratedWorkTrackerWorkItemFieldsFragment | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId: compactWorktrackerId(membership.moduleId) },
    optimistic: true,
    returnPartialData: true,
  })?.work_items?.nodes.find(
    (candidate) => candidate.id === compactWorktrackerId(id) || candidate.id === id,
  );
}

export function useReorderWorkItem(membership: ModuleMembership) {
  return useApolloWorkItemMutation(
    ({ id, beforeId, afterId }: ReorderWorkItemArgs, optimistic) =>
      reorderWorkItem(
        id,
        { before_id: beforeId, after_id: afterId },
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
    (body: WorkItemCreate) => createWorkItem(
      membership.projectId,
      body,
      {
        optimistic: optimisticCreatedIssue(studioApolloClient().cache, membership, body),
        moduleId: membership.moduleId,
      },
    ),
    () => null,
  );
}
