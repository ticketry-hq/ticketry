import { create } from "zustand";
import * as api from "../../../shared/api/client";
import { ApiError } from "../../../shared/api/client";
import type { State, WorkItem, WorkItemCreate } from "../../../shared/api/types";
import { useIssueStore } from "../issue-detail/internal/issueStore";
import { rankBetween } from "../utilities/rank";
import {
  getStatesSnapshot,
  reloadStates,
  setStates,
} from "../../../shared/query/stateCatalog";

export {
  compareRank,
  owningEpic,
  cardHierarchy,
  buildCardMeta,
  isStory,
  NO_EPIC,
  matchesQuery,
  toggleEpic,
  groupBacklog,
  groupBacklogByState,
  EMPTY_PLANNING,
} from "./backlogSelectors";

export type {
  BacklogFilters,
  PlanningAxes,
  CardHierarchy,
  TreeNode,
  EpicGroup,
  StateGroup,
} from "./backlogSelectors";

import type { BacklogFilters } from "./backlogSelectors";

export interface BulkResult {
  ok: number;
  failed: number;
}

export interface StateRevisionDelta {
  state: State | null;
  revision: number;
  updatedAt: string;
}

export interface BacklogState {
  projectId: string | null;
  /** Membership only. Work-item records live in useIssueStore. */
  itemIds: string[];
  /**
   * Derived compatibility projection for legacy selectors. This accessor never
   * stores records in the backlog state; it resolves itemIds from the owner.
   */
  readonly items: WorkItem[];
  /** Derived compatibility aliases for the canonical owner's revision guards. */
  readonly seenStateRevisions: Record<string, number>;
  readonly pendingStateDeltas: Record<string, StateRevisionDelta>;
  /**
   * Derived from the one shared workflow-state catalog — the backlog holds no
   * copy. React surfaces must read it through useCachedStates instead of this
   * accessor: a catalog change notifies query subscribers, not zustand's.
   */
  readonly states: State[];
  filters: BacklogFilters;
  loading: boolean;
  error: string | null;
  loadError: string | null;

  loadBacklog: (projectId: string) => Promise<void>;
  setFilter: (patch: Partial<BacklogFilters>) => void;
  createIssue: (projectId: string, body: WorkItemCreate) => Promise<WorkItem | null>;
  reparent: (id: string, parentId: string | null) => Promise<void>;
  setItemState: (itemId: string, stateId: string) => Promise<void>;
  reorderItem: (itemId: string, beforeId: string | null, afterId: string | null) => Promise<void>;
  deleteIssue: (id: string) => Promise<void>;
  bulkSetState: (ids: string[], stateId: string) => Promise<BulkResult>;
  bulkDelete: (ids: string[]) => Promise<{ deleted: number; skipped: string[] }>;

  /** Membership reconciliation boundary; the record is written only by the owner. */
  applyServerItem: (item: WorkItem) => void;
  /** Compatibility router for callers during the migration; ownership remains canonical. */
  applyStateDelta: (itemId: string, state: State | null, revision: number, updatedAt: string) => boolean;
  reconcileTargetedItem: (item: WorkItem, requestedRevision: number) => "applied" | "ignored" | "stale";
  removeReconciledItem: (itemId: string, requestedRevision: number) => boolean;
  /** Optimistically maintain reverse dependency edges on the canonical records. */
  mirrorBlockerChange: (blockedId: string, addedBlockerIds: string[], removedBlockerIds: string[]) => void;
}

const EMPTY_FILTERS: BacklogFilters = { query: "" };

function errMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function resolveItems(ids: string[]): WorkItem[] {
  const byId = useIssueStore.getState().workItemsById;
  return ids.map((id) => byId[id]).filter((item): item is WorkItem => item !== undefined);
}

function mergeIds(existing: string[], ids: string[]): string[] {
  const known = new Set(existing);
  return [...existing, ...ids.filter((id) => !known.has(id))];
}

function attachDerivedItems(state: BacklogState): void {
  Object.defineProperty(state, "items", {
    configurable: true,
    enumerable: false,
    get: () => resolveItems(state.itemIds),
  });
  Object.defineProperties(state, {
    seenStateRevisions: {
      configurable: true,
      enumerable: false,
      get: () => useIssueStore.getState().seenStateRevisions,
    },
    pendingStateDeltas: {
      configurable: true,
      enumerable: false,
      get: () => useIssueStore.getState().pendingStateDeltas,
    },
    states: {
      configurable: true,
      enumerable: false,
      get: () => getStatesSnapshot(state.projectId),
    },
  });
}

const createBacklogState = (set: (partial: Partial<BacklogState>) => void, get: () => BacklogState): BacklogState => ({
  projectId: null,
  itemIds: [],
  filters: EMPTY_FILTERS,
  loading: false,
  error: null,
  loadError: null,

  async loadBacklog(projectId) {
    const switchingProject = get().projectId !== projectId;
    set({
      projectId,
      loading: true,
      loadError: null,
      ...(switchingProject ? { itemIds: [] } : {}),
    });
    try {
      const [items] = await Promise.all([
        api.listProjectWorkItems(projectId, { includePathfind: true }),
        reloadStates(projectId),
      ]);
      if (get().projectId !== projectId) return;
      useIssueStore.getState().hydrateWorkItems(items);
      set({
        itemIds: items.filter((item) => !item.is_archived).map((item) => item.id),
        loading: false,
        ...(switchingProject ? { filters: EMPTY_FILTERS } : {}),
      });
    } catch (error) {
      set({ loadError: errMessage(error), loading: false });
    }
  },

  setFilter(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  async createIssue(projectId, body) {
    try {
      const created = await api.createWorkItem(projectId, body);
      useIssueStore.getState().hydrateWorkItems([created]);
      set({ itemIds: mergeIds(get().itemIds, [created.id]), error: null });
      return created;
    } catch (error) {
      set({ error: errMessage(error) });
      return null;
    }
  },

  async reparent(id, parentId) {
    const updated = await useIssueStore.getState().patchWorkItem(id, { parent_id: parentId }, get().states);
    if (!updated) set({ error: useIssueStore.getState().error ?? "Unable to update parent." });
  },

  async setItemState(itemId, stateId) {
    const updated = await useIssueStore.getState().setWorkItemState(itemId, stateId, get().states);
    if (!updated) set({ error: useIssueStore.getState().error ?? "Unable to update state." });
  },

  async reorderItem(itemId, beforeId, afterId) {
    const items = resolveItems(get().itemIds);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const rankOf = (id: string | null) => id ? items.find((candidate) => candidate.id === id)?.rank ?? null : null;
    let rank: string;
    try {
      rank = rankBetween(rankOf(beforeId), rankOf(afterId));
    } catch {
      return;
    }
    useIssueStore.getState().hydrateWorkItems([{ ...item, rank }]);
    try {
      get().applyServerItem(await api.reorderWorkItem(itemId, { before_id: beforeId, after_id: afterId }));
    } catch (error) {
      useIssueStore.getState().hydrateWorkItems([item]);
      set({ error: errMessage(error) });
    }
  },

  async deleteIssue(id) {
    const snapshot = get().itemIds;
    if (!snapshot.includes(id)) return;
    set({ itemIds: snapshot.filter((itemId) => itemId !== id), error: null });
    try {
      await api.deleteWorkItem(id);
      useIssueStore.getState().removeReconciledWorkItem(id, Number.MAX_SAFE_INTEGER);
    } catch (error) {
      set({ itemIds: snapshot, error: errMessage(error) });
    }
  },

  async bulkSetState(ids, stateId) {
    const items = resolveItems(get().itemIds);
    const target = get().states.find((state) => state.id === stateId) ?? null;
    const byId = new Map(items.map((item) => [item.id, item]));
    const todo = ids.filter((id) => {
      const item = byId.get(id);
      return item && item.state?.id !== stateId;
    });
    if (!todo.length) return { ok: 0, failed: 0 };
    const optimistic = todo.map((id) => ({ ...byId.get(id)!, state: target }));
    useIssueStore.getState().hydrateWorkItems(optimistic);
    const results = await Promise.allSettled(
      todo.map((id) => api.patchWorkItem(id, { state_id: stateId })),
    );
    const failed: string[] = [];
    results.forEach((result, index) => {
      const id = todo[index];
      if (result.status === "fulfilled") get().applyServerItem(result.value);
      else {
        failed.push(id);
        const before = byId.get(id);
        if (before) useIssueStore.getState().hydrateWorkItems([before]);
      }
    });
    return { ok: todo.length - failed.length, failed: failed.length };
  },

  async bulkDelete(ids) {
    const snapshot = get().itemIds;
    const todo = ids.filter((id) => snapshot.includes(id));
    if (!todo.length) return { deleted: 0, skipped: [] };
    const removed = new Set(todo);
    set({ itemIds: snapshot.filter((id) => !removed.has(id)), error: null });
    const results = await Promise.allSettled(todo.map((id) => api.deleteWorkItem(id)));
    const skipped = results.flatMap((result, index) => result.status === "rejected" ? [todo[index]] : []);
    const deleted = todo.filter((id) => !skipped.includes(id));
    deleted.forEach((id) => useIssueStore.getState().removeReconciledWorkItem(id, Number.MAX_SAFE_INTEGER));
    if (skipped.length) set({ itemIds: mergeIds(get().itemIds, skipped) });
    return { deleted: deleted.length, skipped };
  },

  applyServerItem(item) {
    const owner = useIssueStore.getState();
    if (item.is_archived) {
      owner.reconcileWorkItem(item, 0);
      set({ itemIds: get().itemIds.filter((id) => id !== item.id) });
      return;
    }
    const reconciled = owner.reconcileWorkItem(item, 0);
    if (reconciled !== "applied") return;
    set({
      itemIds: (get().projectId === null || get().projectId === item.project_id)
          ? mergeIds(get().itemIds, [item.id])
          : get().itemIds,
    });
  },

  applyStateDelta(itemId, state, revision, updatedAt) {
    return useIssueStore.getState().applyWorkItemStateDelta(itemId, state, revision, updatedAt);
  },

  reconcileTargetedItem(item, requestedRevision) {
    if (item.project_id !== get().projectId) return "ignored";
    const result = useIssueStore.getState().reconcileWorkItem(item, requestedRevision);
    if (result === "applied") get().applyServerItem(item);
    return result;
  },

  removeReconciledItem(itemId, requestedRevision) {
    const removed = useIssueStore.getState().removeReconciledWorkItem(itemId, requestedRevision);
    if (removed || !useIssueStore.getState().getWorkItem(itemId)) {
      set({ itemIds: get().itemIds.filter((id) => id !== itemId) });
      return true;
    }
    return false;
  },

  mirrorBlockerChange(blockedId, addedBlockerIds, removedBlockerIds) {
    const owner = useIssueStore.getState();
    const updates = [
      ...addedBlockerIds.map((id) => {
        const item = owner.getWorkItem(id);
        return item && !item.blocks_ids.includes(blockedId)
          ? { ...item, blocks_ids: [...item.blocks_ids, blockedId] }
          : null;
      }),
      ...removedBlockerIds.map((id) => {
        const item = owner.getWorkItem(id);
        return item && item.blocks_ids.includes(blockedId)
          ? { ...item, blocks_ids: item.blocks_ids.filter((candidate) => candidate !== blockedId) }
          : null;
      }),
    ].filter((item): item is WorkItem => item !== null);
    owner.hydrateWorkItems(updates);
  },
  // Defined after construction so it remains a non-enumerable derived
  // accessor and can never become a second record cache.
  items: [] as WorkItem[],
  seenStateRevisions: {},
  pendingStateDeltas: {},
  states: [] as State[],
});

export const useBacklogStore = create<BacklogState>()((set, get, api) => {
  const setWithDerivedItems = (partial: Partial<BacklogState>) => {
    set(partial);
    attachDerivedItems(api.getState());
  };
  return createBacklogState(setWithDerivedItems, get);
});

attachDerivedItems(useBacklogStore.getState());

const rawSetState = useBacklogStore.setState;
useBacklogStore.setState = ((partial, replace) => {
  const current = useBacklogStore.getState();
  const next = typeof partial === "function" ? partial(current) : partial;
  const {
    items,
    seenStateRevisions,
    pendingStateDeltas,
    states,
    ...withoutItems
  } = next;
  if (items !== undefined) {
    useIssueStore.getState().hydrateWorkItems(items);
    withoutItems.itemIds = items.map((item) => item.id);
  }
  if (states !== undefined) {
    // The backlog owns no catalog copy, so a `states` write lands in the one
    // shared catalog for whichever project this write is about.
    const projectId = withoutItems.projectId ?? current.projectId;
    if (projectId) setStates(projectId, states);
  }
  if (seenStateRevisions !== undefined || pendingStateDeltas !== undefined) {
    useIssueStore.setState({
      ...(seenStateRevisions !== undefined ? { seenStateRevisions } : {}),
      ...(pendingStateDeltas !== undefined ? { pendingStateDeltas } : {}),
    });
  }
  rawSetState(withoutItems, replace);
  attachDerivedItems(useBacklogStore.getState());
}) as typeof useBacklogStore.setState;
