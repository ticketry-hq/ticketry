import { create } from "zustand";
import * as api from "../../shared/api/client";
import { ApiError } from "../../shared/api/client";
import { toast } from "../../state/clientStore";
import {
  getStatesSnapshot,
  removeState,
  setStates,
  setStatesSorted,
  upsertState,
} from "../../shared/query/stateCatalog";
import {
  ensureSettings as ensureSettingsData,
  getIssueTypesSnapshot,
  loadSettings as loadSettingsData,
  refreshSubtreeRunCapabilities as refreshCapabilitiesData,
  setIssueTypes,
  setIssueTypesSorted,
  synchronizeSubtreeRunCapabilities as synchronizeCapabilities,
} from "./queries";
import type {
  IssueType,
  IssueTypeCreate,
  IssueTypePatch,
  State,
  StateCreate,
  StatePatch,
} from "../../shared/api/types";

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// Client state only: which project the settings surface is showing, and the
// last mutation error. Issue types, workflow states, and the subtree-run
// capability map live in the query cache (./queries, shared/query/stateCatalog).
interface SettingsState {
  projectId: string | null;
  /** Mutation-error message — no longer rendered inline; mutations toast (#638). */
  error: string | null;
  /** Page-LOAD error: set only by loadSettings; SettingsView renders THIS inline. */
  loadError: string | null;

  /** Always refetches. Use for an explicit reload (project switch, page load). */
  loadSettings: (projectId: string) => Promise<void>;
  /** Loads at most once per project, sharing one request across N callers. */
  ensureSettings: (projectId: string) => Promise<void>;
  refreshSubtreeRunCapabilities: (projectId: string) => Promise<void>;
  synchronizeSubtreeRunCapabilities: (
    projectId: string,
    issueTypeId: string,
    enabledStateIds: string[],
  ) => void;

  // Issue types (G1)
  createType: (body: IssueTypeCreate) => Promise<IssueType | null>;
  patchType: (id: string, patch: IssueTypePatch) => Promise<void>;
  deleteType: (id: string, reassignTo?: string) => Promise<void>;
  reorderTypes: (orderedIds: string[]) => Promise<void>;

  // Workflow states (G2)
  createState: (body: StateCreate) => Promise<State | null>;
  patchState: (id: string, patch: StatePatch) => Promise<void>;
  deleteState: (id: string, reassignTo?: string) => Promise<void>;
  reorderStates: (orderedIds: string[]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  projectId: null,
  error: null,
  loadError: null,

  async ensureSettings(projectId) {
    set({ projectId });
    try {
      await ensureSettingsData(projectId);
    } catch (e) {
      if (get().projectId === projectId) set({ loadError: errMessage(e) });
    }
  },

  async loadSettings(projectId) {
    set({ projectId, loadError: null });
    try {
      await loadSettingsData(projectId);
    } catch (e) {
      if (get().projectId === projectId) set({ loadError: errMessage(e) });
    }
  },

  async refreshSubtreeRunCapabilities(projectId) {
    await refreshCapabilitiesData(projectId);
  },

  synchronizeSubtreeRunCapabilities(projectId, issueTypeId, enabledStateIds) {
    synchronizeCapabilities(projectId, issueTypeId, enabledStateIds);
  },

  // --- issue types ----------------------------------------------------------

  async createType(body) {
    const projectId = get().projectId;
    if (!projectId) return null;
    try {
      const created = await api.createIssueType(projectId, body);
      setIssueTypesSorted(projectId, [...getIssueTypesSnapshot(projectId), created]);
      return created;
    } catch (e) {
      toast.error(errMessage(e));
      set({ error: errMessage(e) });
      return null;
    }
  },

  async patchType(id, patch) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getIssueTypesSnapshot(projectId);
    setIssueTypes(
      projectId,
      snapshot.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    set({ error: null });
    try {
      const updated = await api.patchIssueType(id, patch);
      setIssueTypesSorted(
        projectId,
        getIssueTypesSnapshot(projectId).map((t) => (t.id === id ? updated : t)),
      );
    } catch (e) {
      setIssueTypes(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async deleteType(id, reassignTo) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getIssueTypesSnapshot(projectId);
    setIssueTypes(projectId, snapshot.filter((t) => t.id !== id));
    set({ error: null });
    try {
      await api.deleteIssueType(id, reassignTo);
      toast.success("Type deleted");
    } catch (e) {
      setIssueTypes(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async reorderTypes(orderedIds) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getIssueTypesSnapshot(projectId);
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    setIssueTypes(
      projectId,
      // Ranked order is the point of the optimistic write, so it must survive
      // the catalog's sort_order normalization until the server answers.
      [...snapshot].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
    );
    set({ error: null });
    try {
      setIssueTypesSorted(projectId, await api.reorderIssueTypes(projectId, orderedIds));
    } catch (e) {
      setIssueTypes(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  // --- workflow states ------------------------------------------------------

  async createState(body) {
    const projectId = get().projectId;
    if (!projectId) return null;
    try {
      const created = await api.createState(projectId, body);
      upsertState(projectId, created);
      return created;
    } catch (e) {
      toast.error(errMessage(e));
      set({ error: errMessage(e) });
      return null;
    }
  },

  async patchState(id, patch) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getStatesSnapshot(projectId);
    setStates(
      projectId,
      snapshot.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
    set({ error: null });
    try {
      const updated = await api.patchState(id, patch);
      upsertState(projectId, updated);
    } catch (e) {
      setStates(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async deleteState(id, reassignTo) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getStatesSnapshot(projectId);
    removeState(projectId, id);
    set({ error: null });
    try {
      await api.deleteState(id, reassignTo);
      toast.success("State deleted");
    } catch (e) {
      setStates(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async reorderStates(orderedIds) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getStatesSnapshot(projectId);
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    setStates(
      projectId,
      [...snapshot].sort(
        (a, b) => (rank.get(a.id ?? "") ?? 0) - (rank.get(b.id ?? "") ?? 0),
      ),
    );
    set({ error: null });
    try {
      setStatesSorted(projectId, await api.reorderStates(projectId, orderedIds));
    } catch (e) {
      setStates(projectId, snapshot);
      set({ error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },
}));
