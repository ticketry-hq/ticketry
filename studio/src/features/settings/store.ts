import { create } from "zustand";
import * as api from "../../shared/api/client";
import { ApiError } from "../../shared/api/client";
import { toast } from "../../app/stores/toastStore";
import type {
  IssueType,
  IssueTypeCreate,
  IssueTypePatch,
  State,
  StateCreate,
  StatePatch,
  SubtreeRunCapabilityMap,
} from "../../shared/api/types";

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

const bySortOrder = <T extends { sort_order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

const capabilityGenerations = new Map<string, number>();

function nextCapabilityGeneration(projectId: string): number {
  const generation = (capabilityGenerations.get(projectId) ?? 0) + 1;
  capabilityGenerations.set(projectId, generation);
  return generation;
}

interface SettingsState {
  projectId: string | null;
  issueTypes: IssueType[];
  states: State[];
  subtreeRunCapabilities: SubtreeRunCapabilityMap;
  capabilitiesLoaded: boolean;
  settingsLoaded: boolean;
  loading: boolean;
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

let inFlightSettings: { projectId: string; request: Promise<void> } | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  projectId: null,
  issueTypes: [],
  states: [],
  subtreeRunCapabilities: {},
  capabilitiesLoaded: false,
  settingsLoaded: false,
  loading: false,
  error: null,
  loadError: null,

  async ensureSettings(projectId) {
    if (get().projectId === projectId && get().capabilitiesLoaded) return;
    if (inFlightSettings?.projectId === projectId) {
      return inFlightSettings.request;
    }
    const request = get()
      .loadSettings(projectId)
      .finally(() => {
        if (inFlightSettings?.request === request) inFlightSettings = null;
      });
    inFlightSettings = { projectId, request };
    return request;
  },

  async loadSettings(projectId) {
    const capabilityGeneration = nextCapabilityGeneration(projectId);
    set({
      projectId,
      loading: true,
      settingsLoaded: false,
      loadError: null,
      subtreeRunCapabilities: {},
      capabilitiesLoaded: false,
    });
    try {
      const [issueTypes, states, subtreeRunCapabilities] = await Promise.all([
        api.listIssueTypes(projectId),
        api.listStates(projectId),
        api.listSubtreeRunCapabilities(projectId),
      ]);
      if (get().projectId !== projectId) return;
      set((state) => ({
        issueTypes: bySortOrder(issueTypes),
        states: bySortOrder(states),
        settingsLoaded: true,
        loading: false,
        ...(capabilityGenerations.get(projectId) === capabilityGeneration
          ? { subtreeRunCapabilities, capabilitiesLoaded: true }
          : {
              subtreeRunCapabilities: state.subtreeRunCapabilities,
              capabilitiesLoaded: state.capabilitiesLoaded,
            }),
      }));
    } catch (e) {
      if (get().projectId === projectId) {
        set({ loadError: errMessage(e), loading: false });
      }
    }
  },

  async refreshSubtreeRunCapabilities(projectId) {
    const capabilityGeneration = nextCapabilityGeneration(projectId);
    try {
      const subtreeRunCapabilities =
        await api.listSubtreeRunCapabilities(projectId);
      if (
        get().projectId === projectId &&
        capabilityGenerations.get(projectId) === capabilityGeneration
      ) {
        set({ subtreeRunCapabilities, capabilitiesLoaded: true });
      }
    } catch {
      // The workflow save already succeeded. Preserve the last known map and
      // let a later project/settings load retry rather than reporting the save
      // itself as failed.
    }
  },

  synchronizeSubtreeRunCapabilities(projectId, issueTypeId, enabledStateIds) {
    nextCapabilityGeneration(projectId);
    if (get().projectId !== projectId) return;
    set((state) => {
      const subtreeRunCapabilities = { ...state.subtreeRunCapabilities };
      if (enabledStateIds.length > 0) {
        subtreeRunCapabilities[issueTypeId] = enabledStateIds;
      } else {
        delete subtreeRunCapabilities[issueTypeId];
      }
      return { subtreeRunCapabilities, capabilitiesLoaded: true };
    });
  },

  // --- issue types ----------------------------------------------------------

  async createType(body) {
    const projectId = get().projectId;
    if (!projectId) return null;
    try {
      const created = await api.createIssueType(projectId, body);
      set({ issueTypes: bySortOrder([...get().issueTypes, created]) });
      return created;
    } catch (e) {
      toast.error(errMessage(e));
      set({ error: errMessage(e) });
      return null;
    }
  },

  async patchType(id, patch) {
    const snapshot = get().issueTypes;
    const optimistic = bySortOrder(
      snapshot.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    set({ issueTypes: optimistic, error: null });
    try {
      const updated = await api.patchIssueType(id, patch);
      set({
        issueTypes: bySortOrder(
          get().issueTypes.map((t) => (t.id === id ? updated : t)),
        ),
      });
    } catch (e) {
      set({ issueTypes: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async deleteType(id, reassignTo) {
    const snapshot = get().issueTypes;
    set({ issueTypes: snapshot.filter((t) => t.id !== id), error: null });
    try {
      await api.deleteIssueType(id, reassignTo);
      toast.success("Type deleted");
    } catch (e) {
      set({ issueTypes: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async reorderTypes(orderedIds) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = get().issueTypes;
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    const optimistic = [...snapshot].sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    );
    set({ issueTypes: optimistic, error: null });
    try {
      const reordered = await api.reorderIssueTypes(projectId, orderedIds);
      set({ issueTypes: bySortOrder(reordered) });
    } catch (e) {
      set({ issueTypes: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  // --- workflow states ------------------------------------------------------

  async createState(body) {
    const projectId = get().projectId;
    if (!projectId) return null;
    try {
      const created = await api.createState(projectId, body);
      set({ states: bySortOrder([...get().states, created]) });
      return created;
    } catch (e) {
      toast.error(errMessage(e));
      set({ error: errMessage(e) });
      return null;
    }
  },

  async patchState(id, patch) {
    const snapshot = get().states;
    const optimistic = bySortOrder(
      snapshot.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
    set({ states: optimistic, error: null });
    try {
      const updated = await api.patchState(id, patch);
      set({
        states: bySortOrder(
          get().states.map((s) => (s.id === id ? updated : s)),
        ),
      });
    } catch (e) {
      set({ states: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async deleteState(id, reassignTo) {
    const snapshot = get().states;
    set({ states: snapshot.filter((s) => s.id !== id), error: null });
    try {
      await api.deleteState(id, reassignTo);
      toast.success("State deleted");
    } catch (e) {
      set({ states: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },

  async reorderStates(orderedIds) {
    const projectId = get().projectId;
    if (!projectId) return;
    const snapshot = get().states;
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    const optimistic = [...snapshot].sort(
      (a, b) => (rank.get(a.id ?? "") ?? 0) - (rank.get(b.id ?? "") ?? 0),
    );
    set({ states: optimistic, error: null });
    try {
      const reordered = await api.reorderStates(projectId, orderedIds);
      set({ states: bySortOrder(reordered) });
    } catch (e) {
      set({ states: snapshot, error: errMessage(e) });
      toast.error(errMessage(e));
    }
  },
}));
