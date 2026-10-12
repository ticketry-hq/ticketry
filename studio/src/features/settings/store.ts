import { createApolloStore } from "../../shared/apollo/localState";
import * as api from "../workflows";
import { issueType, readWorkflowCatalog } from "../workflows/queries/projectCatalog";
import { ApiError } from "../../shared/api/errors";
import { toast } from "../../state/clientStore";
import {
  getStatesSnapshot,
  removeState,
  setStates,
  setStatesSorted,
  upsertState,
} from "../../features/projects";
import {
  ensureSettings as ensureSettingsData,
  getIssueTypesSnapshot,
  loadSettings as loadSettingsData,
  refreshSubtreeRunCapabilities as refreshCapabilitiesData,
  setIssueTypes,
  synchronizeSubtreeRunCapabilities as synchronizeCapabilities,
} from "./queries";
import type { IssueType, IssueTypeCreate, IssueTypePatch, State, StateCreate, StatePatch } from "../workflows";

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// Client state only: which project the settings surface is showing, and the
// last mutation error. Issue types, workflow states, and the subtree-run
// capability map live in the query cache (./queries, features/projects).
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

export const useSettingsStore = createApolloStore<SettingsState>("settings", (set, get) => ({
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
    let committed = false;
    try {
      const row = await api.createIssueType(projectId, body);
      committed = true;
      const catalog = await readWorkflowCatalog(projectId, "network-only");
      const created = catalog.issueTypes.find((type) => type.id === row.id);
      if (!created) throw new Error("The created issue type was absent from the refreshed catalog.");
      return issueType(created);
    } catch (e) {
      const message = committed ? `Issue type created, but the catalog could not be refreshed: ${errMessage(e)}` : errMessage(e);
      toast.error(message);
      set({ error: message });
      return null;
    }
  },

  async patchType(id, patch) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = getIssueTypesSnapshot(projectId);
    setIssueTypes(
      projectId,
      snapshot.map((t) => (t.id === id ? {
        ...t, name: patch.name ?? t.name, color: patch.color ?? t.color,
        sort_order: patch.sortOrder ?? t.sort_order,
      } : t)),
    );
    set({ error: null });
    let committed = false;
    try {
      await api.updateIssueType(id, patch);
      committed = true;
      await readWorkflowCatalog(projectId, "network-only");
    } catch (e) {
      if (!committed) setIssueTypes(projectId, snapshot);
      const message = committed ? `Issue type updated, but the catalog could not be refreshed: ${errMessage(e)}` : errMessage(e);
      set({ error: message });
      toast.error(message);
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
    let committed = false;
    try {
      await api.reorderIssueTypes(projectId, orderedIds);
      committed = true;
      await readWorkflowCatalog(projectId, "network-only");
    } catch (e) {
      if (!committed) setIssueTypes(projectId, snapshot);
      const message = committed ? `Issue types reordered, but the catalog could not be refreshed: ${errMessage(e)}` : errMessage(e);
      set({ error: message });
      toast.error(message);
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
      snapshot.map((s) => (s.id === id ? {
        ...s, name: patch.name ?? s.name, color: patch.color ?? s.color,
        group: patch.group ?? s.group, sort_order: patch.sortOrder ?? s.sort_order,
      } : s)),
    );
    set({ error: null });
    try {
      const updated = await api.updateState(id, patch);
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
