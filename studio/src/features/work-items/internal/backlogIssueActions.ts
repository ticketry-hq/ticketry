import type { State, WorkItem, WorkItemCreate, WorkItemPatch } from "../../../shared/api/types";
import * as api from "../../../shared/api/client";
import { apiErrorMessage } from "../../../shared/api/client";
import { toast } from "../../../app/stores/toastStore";
import { rankBetween } from "../utilities/rank";
import type { BacklogState } from "./backlogStore";

// Surface the workflow gate's structured `detail` on a rejected move (#872).
const errMessage = apiErrorMessage;

function stateMovePatch(stateId: string): WorkItemPatch {
  return { state_id: stateId, force_if_completed: true };
}
export interface BulkResult {
  ok: number;
  failed: number;
}

interface OptimisticStateEntry {
  latestToken: number;
  pendingBases: Map<number, number>;
}

const optimisticStateMoves = new Map<string, OptimisticStateEntry>();
let optimisticStateToken = 0;

export function clearOptimisticStateMoves(): void {
  optimisticStateMoves.clear();
}

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
  const entry = optimisticStateMoves.get(itemId);
  return entry?.pendingBases.get(entry.latestToken);
}

function rollbackUnlessNewer(current: WorkItem, snapshot: WorkItem): WorkItem {
  return (current.state_revision ?? 0) > (snapshot.state_revision ?? 0)
    ? current
    : snapshot;
}

function latestKnownRevision(
  state: BacklogState,
  itemId: string,
  item?: WorkItem,
): number {
  return Math.max(
    state.seenStateRevisions[itemId] ?? 0,
    item?.state_revision ?? 0,
  );
}

// Shared fan-out for the three bulk set-field methods.
async function bulkSet(
  get: () => BacklogState,
  set: (partial: Partial<BacklogState>) => void,
  todo: string[],
  snapshot: WorkItem[],
  optimistic: (i: WorkItem) => WorkItem,
  request: (id: string) => Promise<WorkItem>,
): Promise<BulkResult> {
  if (!todo.length) return { ok: 0, failed: 0 };
  const todoSet = new Set(todo);
  const byId = new Map(snapshot.map((i) => [i.id, i]));
  const moveTokens = new Map<string, number>();
  set({
    items: snapshot.map((i) => (todoSet.has(i.id) ? optimistic(i) : i)),
    error: null,
  });
  todo.forEach((id) => {
    const item = byId.get(id);
    if (item) moveTokens.set(id, beginOptimisticStateMove(item));
  });
  const results = await Promise.allSettled(todo.map((id) => request(id)));
  const failed: string[] = [];
  const rollbackIds = new Set<string>();
  // Collect the distinct failure reasons so a rejected bulk move surfaces *why*
  // (the gate's structured reason), not just a count (#872). A fan-out that hits
  // the same illegal move yields one identical reason → one toast.
  const reasons = new Set<string>();
  results.forEach((r, k) => {
    const id = todo[k];
    const isLatest = finishOptimisticStateMove(id, moveTokens.get(id) ?? -1);
    if (r.status === "fulfilled") {
      if (isLatest) get().applyServerItem(r.value);
    }
    else {
      failed.push(id);
      if (isLatest) rollbackIds.add(id);
      reasons.add(errMessage(r.reason));
    }
  });
  if (failed.length) {
    set({
      items: get().items.map((i) => {
        const previous = byId.get(i.id);
        return rollbackIds.has(i.id) && previous
          ? rollbackUnlessNewer(i, previous)
          : i;
      }),
    });
    reasons.forEach((message) => toast.error(message));
  }
  return { ok: todo.length - failed.length, failed: failed.length };
}

export async function createIssue(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  projectId: string,
  body: WorkItemCreate,
): Promise<WorkItem | null> {
  try {
    const created = await api.createWorkItem(projectId, body);
    set({ items: [...get().items, created] });
    toast.success("Issue created");
    return created;
  } catch (e) {
    toast.error(errMessage(e));
    set({ error: errMessage(e) });
    return null;
  }
}

export async function reparent(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  id: string,
  parentId: string | null,
): Promise<void> {
  const snapshot = get().items;
  const optimistic = snapshot.map((i) =>
    i.id === id ? { ...i, parent_id: parentId } : i,
  );
  set({ items: optimistic, error: null });
  try {
    const updated = await api.patchWorkItem(id, { parent_id: parentId });
    get().applyServerItem(updated);
  } catch (e) {
    set({ items: snapshot, error: errMessage(e) });
    toast.error(errMessage(e));
  }
}

export async function setItemState(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  itemId: string,
  stateId: string,
): Promise<void> {
  const snapshot = get().items;
  const item = snapshot.find((i) => i.id === itemId);
  if (!item) return;
  // Same column → no-op, no PATCH.
  if ((item.state?.id ?? null) === stateId) return;
  // Look up the target State so the card carries the real color/group while
  // the PATCH is in flight; the server's nested state reconciles on success.
  const target = get().states.find((s) => s.id === stateId) ?? null;
  const optimistic = snapshot.map((i) =>
    i.id === itemId ? { ...i, state: target } : i,
  );
  const moveToken = beginOptimisticStateMove(item);
  set({ items: optimistic, error: null });
  try {
    // Always by UUID id, never KEY-N (the PATCH resolver is pk-only).
    const updated = await api.patchWorkItem(itemId, stateMovePatch(stateId));
    if (finishOptimisticStateMove(itemId, moveToken)) {
      get().applyServerItem(updated);
    }
  } catch (e) {
    if (finishOptimisticStateMove(itemId, moveToken)) {
      set({
        items: get().items.map((candidate) =>
          candidate.id === itemId
            ? rollbackUnlessNewer(candidate, item)
            : candidate,
        ),
        error: errMessage(e),
      });
    }
    toast.error(errMessage(e));
  }
}

export async function reorderItem(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  itemId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<void> {
  const snapshot = get().items;
  const item = snapshot.find((i) => i.id === itemId);
  if (!item) return;
  const rankOf = (id: string | null) =>
    id ? (snapshot.find((i) => i.id === id)?.rank ?? null) : null;
  let optimisticRank: string;
  try {
    optimisticRank = rankBetween(rankOf(beforeId), rankOf(afterId));
  } catch {
    return; // inverted neighbors — ignore the drop
  }
  const optimistic = snapshot.map((i) =>
    i.id === itemId ? { ...i, rank: optimisticRank } : i,
  );
  set({ items: optimistic, error: null });
  try {
    const updated = await api.reorderWorkItem(itemId, {
      before_id: beforeId,
      after_id: afterId,
    });
    get().applyServerItem(updated);
  } catch (e) {
    set({ items: snapshot, error: errMessage(e) });
    toast.error(errMessage(e));
  }
}

export async function deleteIssue(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  id: string,
): Promise<void> {
  const snapshot = get().items;
  // The server blocks deleting an issue that still has children (409, no
  // subtree loss). Optimistically drop the row; a 409 (or any error) rolls
  // it back and surfaces the message so the caller can re-parent first.
  set({ items: snapshot.filter((i) => i.id !== id), error: null });
  try {
    await api.deleteWorkItem(id);
    toast.success("Issue deleted");
  } catch (e) {
    set({ items: snapshot, error: errMessage(e) });
    toast.error(errMessage(e));
  }
}

export async function bulkSetState(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  ids: string[],
  stateId: string,
): Promise<BulkResult> {
  const snapshot = get().items;
  const target = get().states.find((s) => s.id === stateId) ?? null;
  // Skip ids already at the target value (mirrors setItemState's early-return).
  const todo = ids.filter((id) => {
    const it = snapshot.find((i) => i.id === id);
    return it && (it.state?.id ?? null) !== stateId;
  });
  return bulkSet(get, set, todo, snapshot, (i) => ({ ...i, state: target }), (id) =>
    api.patchWorkItem(id, stateMovePatch(stateId)),
  );
}

export async function bulkDelete(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  ids: string[],
): Promise<{ deleted: number; skipped: string[] }> {
  const snapshot = get().items;
  const byId = new Map(snapshot.map((i) => [i.id, i]));
  // Only delete ids that are actually present (a concurrent reload may have
  // dropped some); a missing id is silently a no-op, not a failure.
  const todo = ids.filter((id) => byId.has(id));
  if (!todo.length) return { deleted: 0, skipped: [] };
  const idSet = new Set(todo);
  set({ items: snapshot.filter((i) => !idSet.has(i.id)), error: null });
  const results = await Promise.allSettled(todo.map((id) => api.deleteWorkItem(id)));
  // A rejected delete is restored and reported as skipped (a 409 = has
  // sub-tasks; any other error is collected the same way for this slice).
  const skipped: string[] = [];
  results.forEach((r, k) => {
    if (r.status === "rejected") skipped.push(todo[k]);
  });
  if (skipped.length) {
    const present = new Set(get().items.map((i) => i.id));
    const restored = [...get().items];
    for (const id of skipped) {
      if (!present.has(id)) {
        const it = byId.get(id);
        if (it) restored.push(it);
      }
    }
    set({ items: restored });
  }
  return { deleted: todo.length - skipped.length, skipped };
}

export function applyServerItem(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  item: WorkItem,
): void {
  const items = get().items;
  const current = items.find((candidate) => candidate.id === item.id);
  const incomingRevision = item.state_revision ?? 0;
  const latestRevision = latestKnownRevision(get(), item.id, current);
  if (incomingRevision < latestRevision) return;
  const seenStateRevisions = {
    ...get().seenStateRevisions,
    [item.id]: Math.max(get().seenStateRevisions[item.id] ?? 0, incomingRevision),
  };
  const pendingStateDeltas = { ...get().pendingStateDeltas };
  if ((pendingStateDeltas[item.id]?.revision ?? Infinity) <= incomingRevision) {
    delete pendingStateDeltas[item.id];
  }
  // Cancel = archive (#633): a patch that archives the item (cancelling it)
  // drops it from the store so it leaves every active surface. "Just don't
  // show it" — no FE descendant walk; cascade-archived children disappear on
  // the next project load. An un-cancel returns is_archived=false and the
  // item reappears in its now-active state.
  if (item.is_archived) {
    set({
      items: items.filter((i) => i.id !== item.id),
      seenStateRevisions,
      pendingStateDeltas,
    });
    return;
  }
  const exists = items.some((i) => i.id === item.id);
  set({
    items: exists
      ? items.map((i) => (i.id === item.id ? item : i))
      : [...items, item],
    seenStateRevisions,
    pendingStateDeltas,
  });
}

/**
 * Merge a project-feed state delta without replacing the cached work item.
 *
 * Project-monotonic revisions, never browser timestamps, define ordering.
 * The latest delta is retained even when the item is not loaded yet so the
 * initial Backlog request cannot overwrite a frame received while loading.
 */
export function applyStateDelta(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  itemId: string,
  state: State | null,
  revision: number,
  updatedAt: string,
): boolean {
  if (!Number.isSafeInteger(revision) || revision < 0) return false;
  const item = get().items.find((candidate) => candidate.id === itemId);
  const latestRevision = latestKnownRevision(get(), itemId, item);
  if (revision <= latestRevision) return false;
  const seenStateRevisions = { ...get().seenStateRevisions, [itemId]: revision };
  const pendingStateDeltas = {
    ...get().pendingStateDeltas,
    [itemId]: { state, revision, updatedAt },
  };
  set({
    items: item
      ? get().items.map((candidate) =>
          candidate.id === itemId
            ? { ...candidate, state, state_revision: revision, updated_at: updatedAt }
            : candidate,
        )
      : get().items,
    seenStateRevisions,
    pendingStateDeltas,
  });
  return true;
}

export function reconcileTargetedItem(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  item: WorkItem,
  requestedRevision: number,
): "applied" | "ignored" | "stale" {
  if (item.project_id !== get().projectId) return "ignored";
  const incomingRevision = item.state_revision ?? 0;
  if (incomingRevision < requestedRevision) return "stale";
  if ((get().seenStateRevisions[item.id] ?? 0) > incomingRevision) return "ignored";
  const optimisticBase = optimisticStateBase(item.id);
  if (optimisticBase !== undefined && incomingRevision <= optimisticBase) {
    return "ignored";
  }
  applyServerItem(set, get, item);
  return "applied";
}

export function removeReconciledItem(
  set: (partial: Partial<BacklogState>) => void,
  get: () => BacklogState,
  itemId: string,
  requestedRevision: number,
): boolean {
  const item = get().items.find((candidate) => candidate.id === itemId);
  const latestRevision = latestKnownRevision(get(), itemId, item);
  if (latestRevision > requestedRevision) return false;
  const optimisticBase = optimisticStateBase(itemId);
  if (optimisticBase !== undefined && requestedRevision <= optimisticBase) {
    return false;
  }
  const pendingStateDeltas = { ...get().pendingStateDeltas };
  delete pendingStateDeltas[itemId];
  set({
    items: get().items.filter((candidate) => candidate.id !== itemId),
    seenStateRevisions: {
      ...get().seenStateRevisions,
      [itemId]: Math.max(latestRevision, requestedRevision),
    },
    pendingStateDeltas,
  });
  return true;
}
