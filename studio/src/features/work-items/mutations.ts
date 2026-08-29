import { useCallback, useState } from "react";
import type { IssueType, State, WorkItem, WorkItemCreate } from "../../shared/api/types";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
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
      transitionWorkItem(id, state.id, { optimistic }),
    ({ id }: SetWorkItemStateArgs) => id,
    (current, { state }) => ({
      ...current,
      state_id: compactWorktrackerId(state.id),
      state_record: {
        id: compactWorktrackerId(state.id),
        name: state.name,
        group: state.group,
        color: state.color ?? "",
        sort_order: state.sort_order ?? 0,
        is_protected: state.is_protected ?? false,
      },
    }),
  );
}

export interface SetWorkItemParentArgs { id: string; parentId: string | null }

export function useSetWorkItemParent(_memberships: readonly ModuleMembership[]) {
  return useApolloWorkItemMutation(
    ({ id, parentId }: SetWorkItemParentArgs, optimistic) =>
      reparentWorkItem(id, parentId, { optimistic }),
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
      setWorkItemBlockers(id, blockedByIds, { optimistic }),
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
    (current, { beforeId, afterId }) => ({
      ...current,
      rank: rankBetween(
        beforeId ? cachedModuleIssue(membership, beforeId)?.rank ?? cachedRank(beforeId) : null,
        afterId ? cachedModuleIssue(membership, afterId)?.rank ?? cachedRank(afterId) : null,
      ),
    }),
    ({ id }) => cachedModuleIssue(membership, id),
  );
}

let optimisticSequence = 0;

function optimisticCreatedIssue(
  membership: ModuleMembership,
  body: WorkItemCreate,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  const now = new Date().toISOString();
  return {
    id: `optimistic:${++optimisticSequence}`,
    name: body.name ?? "",
    project_id: compactWorktrackerId(membership.projectId),
    sequence_id: -optimisticSequence,
    state_id: body.state_id ? compactWorktrackerId(body.state_id) : null,
    description: body.description ?? "",
    workspace_tab_order: [],
    parent_id: body.parent_id ? compactWorktrackerId(body.parent_id) : compactWorktrackerId(membership.moduleId),
    module_id: compactWorktrackerId(membership.moduleId),
    is_archived: false,
    created_at: now,
    updated_at: now,
    rank: "z",
    issue_type_id: compactWorktrackerId(body.issue_type_id ?? ""),
    project: null,
    state_record: null,
    issue_type_record: null,
    children: { nodes: [] },
    blocked_by_edges: { nodes: [] },
    blocks_edges: { nodes: [] },
  };
}

export function useCreateWorkItem(membership: ModuleMembership) {
  return useApolloWorkItemMutation(
    (body: WorkItemCreate) => createWorkItem(
      membership.projectId,
      body,
      {
        optimistic: optimisticCreatedIssue(membership, body),
        moduleId: membership.moduleId,
      },
    ),
    () => null,
  );
}
