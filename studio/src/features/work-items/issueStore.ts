import { create } from "zustand";
import * as api from "../../shared/api/client";
import { ApiError, apiErrorMessage, isNoOpTransition } from "../../shared/api/client";
import type {
  State,
  WorkItem,
  WorkItemDetail,
  WorkItemPatch,
} from "../../shared/api/types";
import { useBacklogStore } from "./internal/backlogStore";
import { useStudioStore } from "../projects/store";
import { toast } from "../../state/clientStore";
export {
  deriveEpic,
  resolveBlockerChips,
} from "./selectors";
export type { BlockerChip } from "./selectors";
import {
  overlayAuthoritativeState,
  stateCatalogChangedSinceGeneration,
  stateCatalogGeneration,
} from "../../shared/stateCatalogRevision";
import {
  loadChildWorkItems,
  loadWorkItemDetail,
  getWorkItemIndexSnapshot,
  getChildWorkItemsSnapshot,
  getWorkItemDetailSnapshot,
  setChildWorkItems,
  setWorkItemDetail,
  setWorkItemIndex,
} from "./queries";

// Surface the workflow gate's structured `detail` on a rejected move (#872).
const errMessage = apiErrorMessage;

// Resolve the optimistic shape of a single edited field so selected-ticket
// details update before the server round-trip; WorkItemOut then reconciles it.
function applyPatchLocally(
  task: WorkItem,
  patch: WorkItemPatch,
  states: State[],
): WorkItem {
  const next = { ...task };
  if ("name" in patch && patch.name !== undefined) next.name = patch.name;
  if ("description" in patch) next.description = patch.description ?? null;
  if ("parent_id" in patch) next.parent_id = patch.parent_id ?? null;
  if ("blocked_by_ids" in patch && patch.blocked_by_ids !== undefined) {
    next.blocked_by_ids = patch.blocked_by_ids;
  }
  if ("state_id" in patch) {
    next.state = patch.state_id
      ? states.find((s) => s.id === patch.state_id) ?? next.state
      : null;
  }
  return next;
}

let inflight: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let activeOpenId: string | null = null;
const EMPTY_CHILDREN: WorkItem[] = [];
// Child discovery is independently asynchronous. Keep a generation alongside
// the detail refresh so a response started by a previous selection (or a host
// that has since unmounted) cannot replace the current selection's children.
let childrenLoadGeneration = 0;
// Marks an `open` value that came from a cache-backed selection paint. A
// pre-existing detail opened through a deep link still keeps its child
// reconciliation behaviour when another host mounts it.
let selectionPaintId: string | null = null;

function cancelPendingIssueLoad() {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  inflight?.abort();
  inflight = null;
}

interface StateRevisionDelta {
  state: State | null;
  revision: number;
  updatedAt: string;
}

interface OptimisticStateEntry {
  latestToken: number;
  pendingBases: Map<number, number>;
}

const optimisticStateMoves = new Map<string, OptimisticStateEntry>();
let optimisticStateToken = 0;

function beginOptimisticStateMove(item: WorkItem): number {
  const token = ++optimisticStateToken;
  const entry = optimisticStateMoves.get(item.id) ?? {
    latestToken: token,
    pendingBases: new Map<number, number>(),
  };
  entry.latestToken = token;
  entry.pendingBases.set(token, item.state_revision ?? 0);
  optimisticStateMoves.set(item.id, entry);
  return token;
}

function finishOptimisticStateMove(itemId: string, token: number): boolean {
  const entry = optimisticStateMoves.get(itemId);
  if (!entry) return false;
  const isLatest = entry.latestToken === token;
  entry.pendingBases.delete(token);
  if (entry.pendingBases.size === 0) optimisticStateMoves.delete(itemId);
  return isLatest;
}

function optimisticStateBase(itemId: string): number | undefined {
  return optimisticStateMoves.get(itemId)?.pendingBases.get(
    optimisticStateMoves.get(itemId)?.latestToken ?? -1,
  );
}

function latestKnownRevision(
  state: Pick<IssueState, "seenStateRevisions" | "workItemsById">,
  itemId: string,
): number {
  return Math.max(
    state.seenStateRevisions[itemId] ?? 0,
    state.workItemsById[itemId]?.state_revision ?? 0,
  );
}

interface IssueState {
  /** The client-side work-item owner; values retain the full backend shape. */
  workItemsById: Record<string, WorkItem>;
  /** Reverse lookup for links addressed as a key, such as MEML-7. */
  workItemIdByKey: Record<string, string>;
  /** Parent id → child ids, each resolving through workItemsById. */
  childWorkItemIds: Record<string, string[]>;
  open: WorkItemDetail | null;
  children: WorkItem[];
  loading: boolean;
  notFound: boolean;
  /** Mutation-error message — no longer rendered inline; mutations toast (#638). */
  error: string | null;
  /** Page-LOAD error (non-404): set by openIssue; IssueDetail renders THIS inline. */
  loadError: string | null;
  /** Per-field in-flight flags, keyed by the patched field name. */
  saving: Record<string, boolean>;
  /** Revision guards belong with the records they protect. */
  seenStateRevisions: Record<string, number>;
  pendingStateDeltas: Record<string, StateRevisionDelta>;

  /** Insert authoritative records without reducing them to presentation rows. */
  hydrateWorkItems: (items: WorkItem[]) => void;
  getWorkItem: (id: string) => WorkItem | null;
  getWorkItemByKey: (key: string) => WorkItem | null;
  getChildWorkItems: (parentId: string) => WorkItem[];
  patchWorkItem: (
    id: string,
    patch: WorkItemPatch,
    states?: State[],
  ) => Promise<WorkItem | null>;
  setWorkItemState: (
    id: string,
    stateId: string,
    states?: State[],
  ) => Promise<WorkItem | null>;
  applyWorkItemStateDelta: (
    itemId: string,
    state: State | null,
    revision: number,
    updatedAt: string,
  ) => boolean;
  reconcileWorkItem: (
    item: WorkItem,
    requestedRevision: number,
  ) => "applied" | "ignored" | "stale";
  removeReconciledWorkItem: (itemId: string, requestedRevision: number) => boolean;
  openIssue: (keyOrId: string) => Promise<void>;
  reloadIssue: (keyOrId: string) => Promise<WorkItemDetail | null>;
  closeIssue: () => void;
  patchField: (patch: WorkItemPatch) => Promise<void>;
  /** Replace the open issue's blocker set, mirroring reverse edges (#624). */
  patchBlockers: (nextIds: string[]) => Promise<void>;
  addSubtask: (name: string, issueTypeId: string) => Promise<void>;
  /** Cancel a child (move it → Cancelled) and reconcile the local child set (#907). */
  cancelChild: (childId: string) => Promise<void>;
  /** Re-fetch the open issue's children — closes the reconcile gap on re-entry (#907). */
  reloadChildren: () => Promise<void>;
}

export const useIssueStore = create<IssueState>((set, get) => ({
  workItemsById: {},
  workItemIdByKey: {},
  childWorkItemIds: {},
  open: null,
  children: [],
  loading: false,
  notFound: false,
  error: null,
  loadError: null,
  saving: {},
  seenStateRevisions: {},
  pendingStateDeltas: {},

  hydrateWorkItems(items) {
    if (items.length === 0) return;
    const current = get();
    const workItemsById = { ...current.workItemsById };
    const workItemIdByKey = { ...current.workItemIdByKey };
    for (const item of items) {
      // The generated SDK represents nullable optional properties as omitted.
      // The work-item boundary promises state is nullable, so restore that
      // distinction before the record enters the canonical owner.
      const canonicalItem = item.state === undefined ? { ...item, state: null } : item;
      const previous = workItemsById[canonicalItem.id];
      if (previous && previous.key !== canonicalItem.key) {
        delete workItemIdByKey[previous.key];
      }
      const pending = current.pendingStateDeltas[canonicalItem.id];
      const incomingRevision = canonicalItem.state_revision ?? 0;
      const protectedItem =
        pending && pending.revision > incomingRevision
          ? {
              ...canonicalItem,
              state: pending.state,
              state_revision: pending.revision,
              updated_at: pending.updatedAt,
            }
          : previous &&
              previous.state_revision === undefined &&
              canonicalItem.state_revision === undefined &&
              Date.parse(previous.updated_at) > Date.parse(canonicalItem.updated_at)
            ? {
                ...canonicalItem,
                state: previous.state,
                updated_at: previous.updated_at,
              }
          : canonicalItem;
      // Preserve nullable state and every lifecycle, dependency, archive,
      // timestamp, and label-colour field from the backend response.
      workItemsById[protectedItem.id] = protectedItem;
      workItemIdByKey[protectedItem.key] = protectedItem.id;
    }
    const childWorkItemIds: Record<string, string[]> = {};
    for (const item of Object.values(workItemsById)) {
      if (item.parent_id) (childWorkItemIds[item.parent_id] ??= []).push(item.id);
    }
    // A child hydrate must not replace an open parent from an unrelated stale
    // entry already in the keyed map. Reconcile the open record only when this
    // response actually supplied that record.
    const hydratedIds = new Set(items.map((item) => item.id));
    const open = current.open && hydratedIds.has(current.open.task.id)
      ? {
          ...current.open,
          task: workItemsById[current.open.task.id] ?? current.open.task,
        }
      : current.open;
    const children = current.children.map(
      (child) => workItemsById[child.id] ?? child,
    );
    const index = setWorkItemIndex(workItemsById);
    set({ ...index, open, children });
  },

  getWorkItem(id) {
    return get().workItemsById[id] ?? null;
  },

  getWorkItemByKey(key) {
    const id = get().workItemIdByKey[key];
    return id ? get().workItemsById[id] ?? null : null;
  },

  getChildWorkItems(parentId) {
    const state = get();
    return (state.childWorkItemIds[parentId] ?? [])
      .map((id) => state.workItemsById[id])
      .filter((item): item is WorkItem => item !== undefined);
  },

  async patchWorkItem(id, patch, suppliedStates) {
    const current = get();
    const task = current.open?.task.id === id
      ? current.open.task
      : current.workItemsById[id] ?? null;
    if (!task) return null;
    const keys = Object.keys(patch);
    const states = suppliedStates ?? useBacklogStore.getState().states;
    const optimisticTask = applyPatchLocally(task, patch, states);
    const stateMoveToken = "state_id" in patch
      ? beginOptimisticStateMove(task)
      : null;
    get().hydrateWorkItems([optimisticTask]);
    set({
      saving: { ...get().saving, ...Object.fromEntries(keys.map((key) => [key, true])) },
      error: null,
    });

    try {
      const updated = await api.patchWorkItem(id, patch);
      const isLatest = stateMoveToken === null || finishOptimisticStateMove(id, stateMoveToken);
      if (isLatest) get().reconcileWorkItem(updated, 0);
      // Compatibility projections remain populated until their owning slices
      // switch to ids. Their writes originate from this one record owner.
      if (isLatest) useBacklogStore.getState().applyServerItem(updated);
      return updated;
    } catch (e) {
      const isLatest = stateMoveToken === null || finishOptimisticStateMove(id, stateMoveToken);
      if (isLatest && latestKnownRevision(get(), id) <= (task.state_revision ?? 0)) {
        get().hydrateWorkItems([task]);
      }
      if (!isNoOpTransition(e)) {
        set({ error: errMessage(e) });
        toast.error(errMessage(e));
      }
      return null;
    } finally {
      const saving = { ...get().saving };
      keys.forEach((key) => delete saving[key]);
      set({ saving });
    }
  },

  async setWorkItemState(id, stateId, states) {
    const open = get().open;
    const task = open?.task.id === id
      ? open.task
      : get().workItemsById[id] ?? null;
    if (!task || (task.state?.id ?? null) === stateId) return task;
    return get().patchWorkItem(id, { state_id: stateId }, states);
  },

  applyWorkItemStateDelta(itemId, state, revision, updatedAt) {
    if (!Number.isSafeInteger(revision) || revision < 0) return false;
    const current = get();
    if (revision <= latestKnownRevision(current, itemId)) return false;
    const pendingStateDeltas = {
      ...current.pendingStateDeltas,
      [itemId]: { state, revision, updatedAt },
    };
    set({
      seenStateRevisions: { ...current.seenStateRevisions, [itemId]: revision },
      pendingStateDeltas,
    });
    const item = current.workItemsById[itemId];
    if (item) {
      get().hydrateWorkItems([{
        ...item,
        state,
        state_revision: revision,
        updated_at: updatedAt,
      }]);
    }
    return true;
  },

  reconcileWorkItem(item, requestedRevision) {
    const current = get();
    const incomingRevision = item.state_revision ?? 0;
    if (incomingRevision < requestedRevision) return "stale";
    if (latestKnownRevision(current, item.id) > incomingRevision) return "ignored";
    const optimisticBase = optimisticStateBase(item.id);
    if (optimisticBase !== undefined && incomingRevision <= optimisticBase) {
      return "ignored";
    }
    if (item.is_archived) {
      return get().removeReconciledWorkItem(item.id, requestedRevision)
        ? "applied"
        : "ignored";
    }
    const pendingStateDeltas = { ...current.pendingStateDeltas };
    if ((pendingStateDeltas[item.id]?.revision ?? Infinity) <= incomingRevision) {
      delete pendingStateDeltas[item.id];
    }
    set({
      seenStateRevisions: {
        ...current.seenStateRevisions,
        [item.id]: Math.max(current.seenStateRevisions[item.id] ?? 0, incomingRevision),
      },
      pendingStateDeltas,
    });
    get().hydrateWorkItems([item]);
    return "applied";
  },

  removeReconciledWorkItem(itemId, requestedRevision) {
    const current = get();
    if (latestKnownRevision(current, itemId) > requestedRevision) return false;
    if (!current.workItemsById[itemId]) return false;
    if (optimisticStateBase(itemId) !== undefined) return false;
    const workItemsById = { ...current.workItemsById };
    const removed = workItemsById[itemId];
    delete workItemsById[itemId];
    const workItemIdByKey = { ...current.workItemIdByKey };
    delete workItemIdByKey[removed.key];
    const childWorkItemIds: Record<string, string[]> = {};
    for (const item of Object.values(workItemsById)) {
      if (item.parent_id) (childWorkItemIds[item.parent_id] ??= []).push(item.id);
    }
    const pendingStateDeltas = { ...current.pendingStateDeltas };
    delete pendingStateDeltas[itemId];
    const index = setWorkItemIndex(workItemsById);
    set({
      ...index,
      open: current.open?.task.id === itemId ? null : current.open,
      children: current.children.filter((child) => child.id !== itemId),
      seenStateRevisions: {
        ...current.seenStateRevisions,
        [itemId]: Math.max(latestKnownRevision(current, itemId), requestedRevision),
      },
      pendingStateDeltas,
    });
    return true;
  },

  async openIssue(keyOrId) {
    const current = get().open;
    const cached = get().getWorkItem(keyOrId) ?? get().getWorkItemByKey(keyOrId);
    if (current && (current.task.key === keyOrId || current.task.id === keyOrId)) {
      // A second host of a freshly painted selection shares its one refresh.
      // Other existing detail hosts retain their historical child reconcile.
      if (selectionPaintId !== current.task.id) void get().reloadChildren();
      return;
    }

    cancelPendingIssueLoad();
    ++childrenLoadGeneration;

    // A module load already gave us the authoritative record. Publish it now
    // so the Details panel's first render is a selection paint, then refresh
    // after the user has had a chance to see it.
    if (cached) {
      const cachedId = cached.id;
      selectionPaintId = cachedId;
      set({
        open: { task: cached, attachments: [] },
        children: get().getChildWorkItems(cachedId),
        loading: false,
        notFound: false,
        loadError: null,
      });

      // The selected module normally already owns this context. Keep the
      // Keep deep-link context work non-blocking and off the paint path.
      void useStudioStore.getState().selectProject(cached.project_id);
      const backlog = useBacklogStore.getState();
      if (backlog.projectId !== cached.project_id) {
        void backlog.loadBacklog(cached.project_id);
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        const controller = new AbortController();
        inflight = controller;
        const catalogGeneration = stateCatalogGeneration();
        void loadWorkItemDetail(cachedId, controller.signal)
          .then((detail) => {
            if (controller.signal.aborted) return;
            const open = get().open;
            // The selection may have changed while this refresh was in flight.
            if (!open || open.task.id !== cachedId) return;
            const reconciledDetail = stateCatalogChangedSinceGeneration(
              catalogGeneration,
            )
              ? {
                  ...detail,
                  task: {
                    ...detail.task,
                    state: overlayAuthoritativeState(
                      detail.task.project_id,
                      detail.task.state,
                    ),
                  },
                }
              : detail;
            get().hydrateWorkItems([reconciledDetail.task]);
            setWorkItemDetail(cachedId, reconciledDetail);
            set({ open: reconciledDetail });
            useBacklogStore.getState().applyServerItem(reconciledDetail.task);
          })
          // The refresh is opportunistic: retain the painted record if it
          // fails, instead of turning a successful selection into an error.
          .catch(() => {})
          .finally(() => {
            if (inflight === controller) {
              inflight = null;
            }
          });
      }, 150);
      return;
    }

    const controller = new AbortController();
    selectionPaintId = null;
    inflight = controller;
    const catalogGeneration = stateCatalogGeneration();
    set({ loading: true, notFound: false, loadError: null, open: null, children: [] });
    try {
      const detail = await loadWorkItemDetail(keyOrId, controller.signal);
      if (controller.signal.aborted) return;
      const projectId = detail.task.project_id;
      const reconciledDetail = stateCatalogChangedSinceGeneration(
        catalogGeneration,
      )
        ? {
            ...detail,
            task: {
              ...detail.task,
              state: overlayAuthoritativeState(projectId, detail.task.state),
            },
          }
        : detail;
      get().hydrateWorkItems([reconciledDetail.task]);
      setWorkItemDetail(keyOrId, reconciledDetail);
      set({ open: reconciledDetail, loading: false });

      // Ensure the issue's project context is live so the Epic derive, the
      // close-to-backlog navigation, and the StatePicker's state list resolve
      // (covers a cold deep-link).
      void useStudioStore.getState().selectProject(projectId);
      const backlog = useBacklogStore.getState();
      if (backlog.projectId !== projectId) void backlog.loadBacklog(projectId);

      const children = await loadChildWorkItems(
        projectId,
        reconciledDetail.task.id,
      );
      if (controller.signal.aborted) return;
      const reconciledChildren = stateCatalogChangedSinceGeneration(catalogGeneration)
          ? children.map((child) => ({
              ...child,
              state: overlayAuthoritativeState(projectId, child.state),
            }))
          : children;
      get().hydrateWorkItems(reconciledChildren);
      setChildWorkItems(reconciledDetail.task.id, reconciledChildren);
      set({ children: reconciledChildren });
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = e instanceof ApiError ? e.status : 0;
      set({ loading: false, notFound: status === 404, loadError: errMessage(e) });
    } finally {
      if (inflight === controller) {
        inflight = null;
      }
    }
  },

  async reloadIssue(keyOrId) {
    const current = get().open;
    if (
      !current ||
      (current.task.key !== keyOrId && current.task.id !== keyOrId)
    ) {
      return null;
    }
    const catalogGeneration = stateCatalogGeneration();
    try {
      const detail = await loadWorkItemDetail(keyOrId);
      const open = get().open;
      if (
        !open ||
        (open.task.key !== keyOrId && open.task.id !== keyOrId)
      ) {
        return null;
      }
      const reconciledDetail = stateCatalogChangedSinceGeneration(
        catalogGeneration,
      )
        ? {
            ...detail,
            task: {
              ...detail.task,
              state: overlayAuthoritativeState(
                detail.task.project_id,
                detail.task.state,
              ),
            },
          }
        : detail;
      get().hydrateWorkItems([reconciledDetail.task]);
      setWorkItemDetail(keyOrId, reconciledDetail);
      set({ open: reconciledDetail });
      useBacklogStore.getState().applyServerItem(reconciledDetail.task);
      return reconciledDetail;
    } catch {
      return null;
    }
  },

  closeIssue() {
    cancelPendingIssueLoad();
    ++childrenLoadGeneration;
    selectionPaintId = null;
    set({ open: null, children: [], loading: false, notFound: false, error: null, loadError: null, saving: {} });
  },

  async patchField(patch) {
    const open = get().open;
    if (!open) return;
    await get().patchWorkItem(open.task.id, patch);
  },

  async patchBlockers(nextIds) {
    const open = get().open;
    if (!open) return;
    const selfId = open.task.id;
    const prevIds = open.task.blocked_by_ids ?? [];

    // One more optimistic patchField (chip appears at once on this issue).
    await get().patchField({ blocked_by_ids: nextIds });

    // Reverse write-through: mirror the change onto the *blockers'* blocks_ids
    // in the backlog, but only for edges the server actually accepted — a 422
    // (self/cycle) rolls patchField back to prevIds, leaving nothing to mirror.
    const after = get().open;
    if (!after || after.task.id !== selfId) return;
    const applied = after.task.blocked_by_ids ?? [];
    const added = applied.filter((id) => !prevIds.includes(id));
    const removed = prevIds.filter((id) => !applied.includes(id));
    if (added.length || removed.length) {
      useBacklogStore.getState().mirrorBlockerChange(selfId, added, removed);
    }
  },

  async addSubtask(name, issueTypeId) {
    const open = get().open;
    if (!name.trim() || !open) return;
    try {
      const child = await api.createWorkItem(open.task.project_id, {
        name: name.trim(),
        parent_id: open.task.id,
        issue_type_id: issueTypeId,
      });
      const currentParent = get().workItemsById[open.task.id] ?? open.task;
      get().hydrateWorkItems([
        child,
        {
          ...currentParent,
          sub_issues_count: currentParent.sub_issues_count + 1,
        },
      ]);
      const cur = get().open;
      if (cur && cur.task.id === open.task.id) {
        set({ children: get().getChildWorkItems(open.task.id) });
      }
      useBacklogStore.getState().applyServerItem(child);
    } catch (e) {
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async cancelChild(childId) {
    const open = get().open;
    if (!open) return;
    const child = get().children.find((c) => c.id === childId);
    if (!child) return;
    const cancelled = useBacklogStore.getState().states.find((s) => s.group === "cancelled");
    if (!cancelled?.id) {
      const message = "No Cancelled state is configured for this project.";
      set({ error: message });
      toast.error(message);
      return;
    }
    try {
      const updated = await api.patchWorkItem(childId, { state_id: cancelled.id });
      const cur = get().open;
      // Reconcile the local child set so the findings panel + count update
      // without a full re-fetch; only if the same parent is still open.
      if (cur && cur.task.id === open.task.id) {
        set({ children: get().children.map((c) => (c.id === childId ? updated : c)) });
      }
      get().hydrateWorkItems([updated]);
      useBacklogStore.getState().applyServerItem(updated);
    } catch (e) {
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async reloadChildren() {
    const open = get().open;
    if (!open) return;
    const parentId = open.task.id;
    const generation = childrenLoadGeneration;
    try {
      const children = await loadChildWorkItems(
        open.task.project_id,
        parentId,
      );
      const cur = get().open;
      if (generation !== childrenLoadGeneration) return;
      get().hydrateWorkItems(children);
      setChildWorkItems(parentId, children);
      if (cur && cur.task.id === parentId) set({ children });
    } catch {
      // A background reconcile failure is non-fatal — keep the stale children
      // rather than surfacing a toast for a refresh the user didn't request.
    }
  },
}));

function attachQueryBackedWorkItemIndex(state: IssueState): void {
  const descriptor = Object.getOwnPropertyDescriptor(state, "workItemsById");
  if (descriptor && "value" in descriptor) {
    setWorkItemIndex(descriptor.value as Record<string, WorkItem>);
  }
  const openDescriptor = Object.getOwnPropertyDescriptor(state, "open");
  if (openDescriptor && "value" in openDescriptor) {
    const open = openDescriptor.value as WorkItemDetail | null;
    activeOpenId = open?.task.id ?? null;
    if (open) setWorkItemDetail(open.task.id, open);
  }
  const childrenDescriptor = Object.getOwnPropertyDescriptor(state, "children");
  if (
    activeOpenId &&
    childrenDescriptor &&
    "value" in childrenDescriptor
  ) {
    setChildWorkItems(
      activeOpenId,
      childrenDescriptor.value as WorkItem[],
    );
  }
  Object.defineProperties(state, {
    workItemsById: {
      configurable: true,
      enumerable: true,
      get: () => getWorkItemIndexSnapshot().workItemsById,
    },
    workItemIdByKey: {
      configurable: true,
      enumerable: true,
      get: () => getWorkItemIndexSnapshot().workItemIdByKey,
    },
    childWorkItemIds: {
      configurable: true,
      enumerable: true,
      get: () => getWorkItemIndexSnapshot().childWorkItemIds,
    },
    open: {
      configurable: true,
      enumerable: true,
      get: () =>
        activeOpenId ? getWorkItemDetailSnapshot(activeOpenId) : null,
    },
    children: {
      configurable: true,
      enumerable: true,
      get: () =>
        activeOpenId
          ? getChildWorkItemsSnapshot(activeOpenId)
          : EMPTY_CHILDREN,
    },
  });
}

attachQueryBackedWorkItemIndex(useIssueStore.getState());
useIssueStore.subscribe(attachQueryBackedWorkItemIndex);
