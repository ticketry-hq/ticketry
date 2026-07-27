import { create } from "zustand";
import * as api from "../../../../shared/api/client";
import { ApiError, apiErrorMessage, isNoOpTransition } from "../../../../shared/api/client";
import type {
  Module,
  State,
  WorkItem,
  WorkItemDetail,
  WorkItemPatch,
} from "../../../../shared/api/types";
import { useBacklogStore } from "../../internal/backlogStore";
import { useStudioStore } from "../../../projects/store";
import { toast } from "../../../../app/stores/toastStore";
import { RESOLVED_GROUPS } from "../../../../shared/utilities/display";
import {
  overlayAuthoritativeState,
  stateCatalogChangedSinceGeneration,
  stateCatalogGeneration,
} from "../../../../shared/stateCatalogRevision";

// Surface the workflow gate's structured `detail` on a rejected move (#872).
const errMessage = apiErrorMessage;

/**
 * Walk the parent chain up to the owning module (the Epic). Resolves once the
 * ancestor items + modules are loaded (backlogStore / studioStore); returns
 * null while a cold deep-link is still hydrating those.
 */
export function deriveEpic(
  task: WorkItem | null,
  modules: Module[],
  items: WorkItem[],
): Module | null {
  if (!task) return null;
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  let pid = task.parent_id;
  const seen = new Set<string>();
  while (pid && !seen.has(pid)) {
    seen.add(pid);
    const epic = moduleById.get(pid);
    if (epic) return epic;
    const parent = itemById.get(pid);
    if (!parent) return null;
    pid = parent.parent_id;
  }
  return null;
}

/** A resolved blocker/blocks chip for the Details panel. */
export interface BlockerChip {
  id: string;
  /** KEY-N, or null when the id isn't in the loaded project set yet. */
  key: string | null;
  name: string | null;
  state: State | null;
  /** Warn (amber): the blocker is still open (state group ∉ completed/cancelled). */
  unresolved: boolean;
}

/**
 * Resolve blocker/blocks ids → navigable chips from the loaded project tree
 * (the same derive-from-the-loaded-set trick deriveEpic uses for the Epic
 * link). An id absent from the loaded set renders as a bare-id chip — still
 * navigable by id — and does not warn (its state is unknown).
 */
export function resolveBlockerChips(
  ids: string[],
  items: WorkItem[],
  modules: Module[],
): BlockerChip[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const moduleById = new Map(modules.map((m) => [m.id, m]));
  return ids.map((id) => {
    const it = itemById.get(id);
    if (it) {
      return {
        id,
        key: it.key,
        name: it.name,
        state: it.state,
        unresolved: !RESOLVED_GROUPS.has(it.state?.group ?? ""),
      };
    }
    const mod = moduleById.get(id);
    if (mod) {
      return { id, key: mod.key, name: mod.name, state: null, unresolved: false };
    }
    return { id, key: null, name: null, state: null, unresolved: false };
  });
}

// Resolve the optimistic shape of a single edited field so the drawer updates
// before the server round-trip; the returned WorkItemOut then reconciles it.
function applyPatchLocally(
  task: WorkItem,
  patch: WorkItemPatch,
  states: State[],
): WorkItem {
  const next = { ...task };
  if ("name" in patch && patch.name !== undefined) next.name = patch.name;
  if ("description_html" in patch) next.description_html = patch.description_html ?? null;
  if ("parent_id" in patch) next.parent_id = patch.parent_id ?? null;
  if ("blocked_by_ids" in patch && patch.blocked_by_ids !== undefined) {
    next.blocked_by_ids = patch.blocked_by_ids;
  }
  if ("labels" in patch && patch.labels !== undefined) {
    // Names → Label chips, reusing any color already known on this issue; a
    // freshly-typed name has no color yet (neutral) until the server replies.
    const colorByName = new Map(task.labels.map((l) => [l.name, l.color]));
    next.labels = patch.labels.map((name) => ({
      name,
      color: colorByName.get(name) ?? null,
    }));
  }
  if ("state_id" in patch) {
    next.state = patch.state_id
      ? states.find((s) => s.id === patch.state_id) ?? next.state
      : null;
  }
  return next;
}

function requestPatch(patch: WorkItemPatch): WorkItemPatch {
  if (!("state_id" in patch)) return patch;
  return { ...patch, force_if_completed: true };
}

let inflight: AbortController | null = null;
// The key/id the in-flight load is for: two hosts asking for the same issue
// (drawer host + IssueDetail's own effect, #827) share one request instead of
// the second abort-restarting the first.
let inflightKey: string | null = null;

interface IssueState {
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

  openIssue: (keyOrId: string) => Promise<void>;
  reloadIssue: (keyOrId: string) => Promise<WorkItemDetail | null>;
  closeIssue: () => void;
  patchField: (patch: WorkItemPatch) => Promise<void>;
  /** Replace the open issue's blocker set, mirroring reverse edges (#624). */
  patchBlockers: (nextIds: string[]) => Promise<void>;
  addSubtask: (name: string) => Promise<void>;
  /** Cancel a child (move it → Cancelled) and reconcile the local child set (#907). */
  cancelChild: (childId: string) => Promise<void>;
  /** Re-fetch the open issue's children — closes the reconcile gap on re-entry (#907). */
  reloadChildren: () => Promise<void>;
}

export const useIssueStore = create<IssueState>((set, get) => ({
  open: null,
  children: [],
  loading: false,
  notFound: false,
  error: null,
  loadError: null,
  saving: {},

  async openIssue(keyOrId) {
    const current = get().open;
    if (current && (current.task.key === keyOrId || current.task.id === keyOrId)) {
      // Already open: the early return is the historical reconcile gap (#907) —
      // returning to a parent after editing/cancelling a child left `children`
      // stale. Re-fetch them so the findings panel and count refresh.
      void get().reloadChildren();
      return;
    }
    if (get().loading && inflightKey === keyOrId) return;
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    inflightKey = keyOrId;
    const catalogGeneration = stateCatalogGeneration();
    set({ loading: true, notFound: false, loadError: null, open: null, children: [] });
    try {
      const detail = await api.getWorkItem(keyOrId, controller.signal);
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
      set({ open: reconciledDetail, loading: false });

      // Ensure the issue's project context is live so the Epic derive, the
      // close-to-backlog navigation, and the StatePicker's state list resolve
      // (covers a cold deep-link / drawer open).
      void useStudioStore.getState().selectProject(projectId);
      const backlog = useBacklogStore.getState();
      if (backlog.projectId !== projectId) void backlog.loadBacklog(projectId);

      const children = await api.listProjectWorkItems(projectId, {
        parent: reconciledDetail.task.id,
      });
      if (controller.signal.aborted) return;
      set({
        children: stateCatalogChangedSinceGeneration(catalogGeneration)
          ? children.map((child) => ({
              ...child,
              state: overlayAuthoritativeState(projectId, child.state),
            }))
          : children,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = e instanceof ApiError ? e.status : 0;
      set({ loading: false, notFound: status === 404, loadError: errMessage(e) });
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
      const detail = await api.getWorkItem(keyOrId);
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
      set({ open: reconciledDetail });
      useBacklogStore.getState().applyServerItem(reconciledDetail.task);
      return reconciledDetail;
    } catch {
      return null;
    }
  },

  closeIssue() {
    inflight?.abort();
    inflightKey = null;
    set({ open: null, children: [], loading: false, notFound: false, error: null, loadError: null, saving: {} });
  },

  async patchField(patch) {
    const open = get().open;
    if (!open) return;
    const id = open.task.id;
    const keys = Object.keys(patch);
    const states = useBacklogStore.getState().states;

    const optimisticTask = applyPatchLocally(open.task, patch, states);
    set({
      open: { ...open, task: optimisticTask },
      saving: { ...get().saving, ...Object.fromEntries(keys.map((k) => [k, true])) },
      error: null,
    });

    try {
      const updated = await api.patchWorkItem(id, requestPatch(patch));
      const cur = get().open;
      // Only reconcile if the same issue is still open.
      if (cur && cur.task.id === id) set({ open: { ...cur, task: updated } });
      useBacklogStore.getState().applyServerItem(updated);
    } catch (e) {
      const cur = get().open;
      if (cur && cur.task.id === id) set({ open: { ...cur, task: open.task } });
      // A same-state re-select is refused server-side but carries no news for
      // the user — roll back silently, no error/toast.
      if (!isNoOpTransition(e)) {
        set({ error: errMessage(e) });
        toast.error(errMessage(e));
      }
    } finally {
      const saving = { ...get().saving };
      keys.forEach((k) => delete saving[k]);
      set({ saving });
    }
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

  async addSubtask(name) {
    const open = get().open;
    if (!name.trim() || !open) return;
    try {
      const child = await api.createWorkItem(open.task.project_id, {
        name: name.trim(),
        parent_id: open.task.id,
      });
      const cur = get().open;
      if (cur && cur.task.id === open.task.id) {
        set({
          children: [...get().children, child],
          open: {
            ...cur,
            task: { ...cur.task, sub_issues_count: cur.task.sub_issues_count + 1 },
          },
        });
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
    // Ask the server to decide from the locked destination row whether this
    // move needs completed-transition forcing; cached group metadata may lag.
    const cancelled = useBacklogStore.getState().states.find((s) => s.group === "cancelled");
    if (!cancelled?.id) {
      const message = "No Cancelled state is configured for this project.";
      set({ error: message });
      toast.error(message);
      return;
    }
    try {
      const updated = await api.patchWorkItem(childId, {
        state_id: cancelled.id,
        force_if_completed: true,
      });
      const cur = get().open;
      // Reconcile the local child set so the findings panel + count update
      // without a full re-fetch; only if the same parent is still open.
      if (cur && cur.task.id === open.task.id) {
        set({ children: get().children.map((c) => (c.id === childId ? updated : c)) });
      }
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
    try {
      const children = await api.listProjectWorkItems(open.task.project_id, {
        parent: parentId,
      });
      const cur = get().open;
      if (cur && cur.task.id === parentId) set({ children });
    } catch {
      // A background reconcile failure is non-fatal — keep the stale children
      // rather than surfacing a toast for a refresh the user didn't request.
    }
  },
}));
