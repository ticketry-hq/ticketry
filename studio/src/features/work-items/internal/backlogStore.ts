import { create } from "zustand";
import * as api from "../../../shared/api/client";
import { ApiError } from "../../../shared/api/client";
import type { State, WorkItem, WorkItemCreate } from "../../../shared/api/types";
import {
  overlayAuthoritativeState,
  stateCatalogChangedSince,
  stateCatalogRevision,
} from "../../../shared/stateCatalogRevision";

// Re-export selectors, helpers, and types from backlogSelectors.ts
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

export type { BulkResult } from "./backlogIssueActions";

import type { BacklogFilters } from "./backlogSelectors";
import type { BulkResult } from "./backlogIssueActions";

// Import action implementations
import * as blockerActions from "./backlogBlockerActions";
import * as issueActions from "./backlogIssueActions";

export interface StateRevisionDelta {
  state: State | null;
  revision: number;
  updatedAt: string;
}

export interface BacklogState {
  projectId: string | null;
  items: WorkItem[];
  states: State[];
  filters: BacklogFilters;
  loading: boolean;
  /**
   * Mutation-error message (rollback case). Kept for back-compat / debugging but
   * no longer rendered inline — mutation failures surface as toasts (#638).
   */
  error: string | null;
  /**
   * Page-LOAD error: set only by loadBacklog. The Backlog renders THIS inline
   * (a failed initial fetch is a page state, not a transient mutation), keeping
   * the load surface separate from the toast channel.
   */
  loadError: string | null;
  /** Latest feed revision observed per WorkItem for the active project. */
  seenStateRevisions: Record<string, number>;
  /** Latest state-only frame, retained until an equally fresh detail arrives. */
  pendingStateDeltas: Record<string, StateRevisionDelta>;

  loadBacklog: (projectId: string) => Promise<void>;
  setFilter: (patch: Partial<BacklogFilters>) => void;
  createIssue: (projectId: string, body: WorkItemCreate) => Promise<WorkItem | null>;
  reparent: (id: string, parentId: string | null) => Promise<void>;
  setItemState: (itemId: string, stateId: string) => Promise<void>;
  /**
   * Within-column reorder (#626): set the item's rank strictly between its two
   * destination neighbors (null = top / bottom / empty). Optimistic with
   * rollback; the server's authoritative rank reconciles on success. Used for
   * list reorder operations.
   */
  reorderItem: (
    itemId: string,
    beforeId: string | null,
    afterId: string | null,
  ) => Promise<void>;
  deleteIssue: (id: string) => Promise<void>;
  /**
   * Bulk actions (#637): fan out a single-item mutation over a selection. Each
   * applies optimistically to all targets at once, fires the PATCHes/DELETEs in
   * parallel (`allSettled`, never `all`), and reconciles per item — a fulfilled
   * result flows through `applyServerItem`, a rejected one rolls back only that
   * row. They return a summary the bulk-action bar renders inline (the store's
   * `error` is left untouched so a partial failure never blanks the whole view).
   */
  bulkSetState: (ids: string[], stateId: string) => Promise<BulkResult>;
  /**
   * Confirm-gated bulk delete: optimistically remove all, fan out deleteWorkItem,
   * restore any that reject (a 409 = "has sub-tasks"), and report how many were
   * deleted vs the ids that survived so the caller can trim the selection.
   */
  bulkDelete: (ids: string[]) => Promise<{ deleted: number; skipped: string[] }>;
  /** Replace an item by id (or insert it) — the cross-store write seam. */
  applyServerItem: (item: WorkItem) => void;
  /** Apply a newer state-only project-feed delta to an already-loaded item. */
  applyStateDelta: (
    itemId: string,
    state: State | null,
    revision: number,
    updatedAt: string,
  ) => boolean;
  /** Reconcile one targeted detail response through revision/optimistic guards. */
  reconcileTargetedItem: (
    item: WorkItem,
    requestedRevision: number,
  ) => "applied" | "ignored" | "stale";
  /** Evict a confirmed missing item unless newer cached truth already exists. */
  removeReconciledItem: (itemId: string, requestedRevision: number) => boolean;
  /**
   * Reverse write-through for blocker edits (#624): when an issue's blocked_by
   * set gains/loses a blocker, mirror it onto each blocker's reverse blocks_ids
   * so the other issue's drawer reads correctly without a refetch.
   */
  mirrorBlockerChange: (
    blockedId: string,
    addedBlockerIds: string[],
    removedBlockerIds: string[],
  ) => void;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

const EMPTY_FILTERS: BacklogFilters = {
  query: "",
};

export const useBacklogStore = create<BacklogState>((set, get) => ({
  projectId: null,
  items: [],
  states: [],
  filters: EMPTY_FILTERS,
  loading: false,
  error: null,
  loadError: null,
  seenStateRevisions: {},
  pendingStateDeltas: {},

  async loadBacklog(projectId) {
    const catalogRevision = stateCatalogRevision(projectId);
    const switchingProject = get().projectId !== projectId;
    if (switchingProject) issueActions.clearOptimisticStateMoves();
    set({
      projectId,
      loading: true,
      loadError: null,
      ...(switchingProject
        ? { items: [], seenStateRevisions: {}, pendingStateDeltas: {} }
        : {}),
    });
    try {
      const [items, states] = await Promise.all([
        api.listProjectWorkItems(projectId, { includePathfind: true }),
        api.listStates(projectId),
      ]);
      // A feed delta may land while this authoritative request is in flight.
      // Keep its newer state revision while taking every other field from the
      // authoritative snapshot. A switched project ignores a late response.
      if (get().projectId !== projectId) return;
      const currentById = new Map(get().items.map((item) => [item.id, item]));
      const pending = get().pendingStateDeltas;
      const catalogChanged = stateCatalogChangedSince(
        projectId,
        catalogRevision,
      );
      const reconciledItems = items.map((item) => {
        const catalogReconciled = catalogChanged
          ? {
              ...item,
              state: overlayAuthoritativeState(projectId, item.state),
            }
          : item;
        const current = currentById.get(item.id);
        const delta = pending[item.id];
        const incomingRevision = catalogReconciled.state_revision ?? 0;
        if (delta && delta.revision > incomingRevision) {
          return {
            ...catalogReconciled,
            state: delta.state,
            state_revision: delta.revision,
            updated_at: delta.updatedAt,
          };
        }
        if (current && (current.state_revision ?? 0) > incomingRevision) {
          return {
            ...item,
            state: current.state,
            state_revision: current.state_revision,
            updated_at: current.updated_at,
          };
        }
        if (
          current &&
          current.state_revision === undefined &&
          item.state_revision === undefined &&
          Date.parse(current.updated_at) > Date.parse(item.updated_at)
        ) {
          return {
            ...item,
            state: current.state,
            updated_at: current.updated_at,
          };
        }
        return catalogReconciled;
      });
      const seenStateRevisions = { ...get().seenStateRevisions };
      for (const item of reconciledItems) {
        seenStateRevisions[item.id] = Math.max(
          seenStateRevisions[item.id] ?? 0,
          item.state_revision ?? 0,
        );
      }
      // Reset filters when the project changes so stale ids never leak across.
      set({
        items: reconciledItems,
        states: catalogChanged ? get().states : states,
        seenStateRevisions,
        loading: false,
        ...(switchingProject ? { filters: EMPTY_FILTERS } : {}),
      });
    } catch (e) {
      set({ loadError: errMessage(e), loading: false });
    }
  },

  setFilter(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  createIssue: (projectId, body) =>
    issueActions.createIssue(set, get, projectId, body),

  reparent: (id, parentId) =>
    issueActions.reparent(set, get, id, parentId),

  setItemState: (itemId, stateId) =>
    issueActions.setItemState(set, get, itemId, stateId),

  reorderItem: (itemId, beforeId, afterId) =>
    issueActions.reorderItem(set, get, itemId, beforeId, afterId),

  deleteIssue: (id) =>
    issueActions.deleteIssue(set, get, id),

  bulkSetState: (ids, stateId) =>
    issueActions.bulkSetState(set, get, ids, stateId),

  bulkDelete: (ids) =>
    issueActions.bulkDelete(set, get, ids),

  applyServerItem: (item) =>
    issueActions.applyServerItem(set, get, item),

  applyStateDelta: (itemId, state, revision, updatedAt) =>
    issueActions.applyStateDelta(set, get, itemId, state, revision, updatedAt),

  reconcileTargetedItem: (item, requestedRevision) =>
    issueActions.reconcileTargetedItem(set, get, item, requestedRevision),

  removeReconciledItem: (itemId, requestedRevision) =>
    issueActions.removeReconciledItem(set, get, itemId, requestedRevision),

  mirrorBlockerChange: (blockedId, addedBlockerIds, removedBlockerIds) =>
    blockerActions.mirrorBlockerChange(set, get, blockedId, addedBlockerIds, removedBlockerIds),
}));
