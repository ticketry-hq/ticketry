import { createApolloStore } from "../../../shared/apollo/localState";
import { readVersionedItem } from "../../../shared/storage/versioned";

const NO_EPIC = "none";

// The shared planning-filter selection (#674), kept separate from
// `useBacklogStore.filters` so the planning surfaces (Story Map #672) own their
// selection independently of the backlog/board chip filters.
// Two independent axes; each axis empty means "all" (the cleared state). The
// store is pure logic plus a localStorage side-channel — it reads no other
// store, so the connected dropdowns pass live data in and `reconcile` receives
// the live id sets. The view-side `setProject` + `reconcile` calls on load are
// wired by the sibling tickets; this subtask ships and unit-tests the store.

interface Selection {
  /** Selected epics: module ids + the `NO_EPIC` sentinel. Empty = all. */
  epicIds: string[];
  /** Selected workflow states: plain state ids, no sentinel. Empty = all. */
  stateIds: string[];
}

interface PlanningFilterState extends Selection {
  /** Whose selection is currently loaded; null before the first setProject. */
  projectId: string | null;
  /** Set the project and load its persisted selection (first visit = empty). */
  setProject: (projectId: string) => void;
  setEpicIds: (ids: string[]) => void;
  setStateIds: (ids: string[]) => void;
  /**
   * Prune stale ids against the live id sets after a data load. An axis whose
   * every selected id is stale collapses to `[]` (= all); the `NO_EPIC`
   * sentinel is never pruned. Persists the pruned result.
   */
  reconcile: (live: {
    moduleIds: string[];
    stateIds: string[];
  }) => void;
}

// Versioned per-project key (client-localstorage-schema); reads migrate the
// legacy unversioned spelling once.
const KEY_PREFIX = "studio.planningFilter:v1:";
const LEGACY_KEY_PREFIX = "studio.planningFilter.";

const EMPTY: Selection = { epicIds: [], stateIds: [] };

// Load a project's persisted selection; a missing/invalid key — or any storage
// failure — degrades to all-empty rather than throwing (mirrors clientStore).
function loadSelection(projectId: string): Selection {
  try {
    const raw = readVersionedItem(KEY_PREFIX + projectId, [
      LEGACY_KEY_PREFIX + projectId,
    ]);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Selection>;
    return {
      epicIds: Array.isArray(parsed.epicIds) ? parsed.epicIds : [],
      stateIds: Array.isArray(parsed.stateIds) ? parsed.stateIds : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

// Persist the current selection under the project's key; swallow any failure so
// the in-memory selection still applies for the session.
function persist(projectId: string | null, sel: Selection): void {
  if (!projectId) return;
  try {
    localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
}

export const usePlanningFilterStore = createApolloStore<PlanningFilterState>("planning-filter", (set, get) => {
  // Persist the three axes from the current state after a mutation.
  const save = (sel: Selection) => persist(get().projectId, sel);

  return {
    projectId: null,
    ...EMPTY,

    setProject: (projectId) =>
      set({ projectId, ...loadSelection(projectId) }),

    setEpicIds: (epicIds) =>
      set((s) => {
        save({ epicIds, stateIds: s.stateIds });
        return { epicIds };
      }),
    setStateIds: (stateIds) =>
      set((s) => {
        save({ epicIds: s.epicIds, stateIds });
        return { stateIds };
      }),

    reconcile: (live) =>
      set((s) => {
        const modules = new Set(live.moduleIds);
        const states = new Set(live.stateIds);
        // The NO_EPIC sentinel is kept unconditionally; real ids survive only
        // if still live. An all-stale axis filters down to [] (= all) on its own.
        const next: Selection = {
          epicIds: s.epicIds.filter((id) => id === NO_EPIC || modules.has(id)),
          stateIds: s.stateIds.filter((id) => states.has(id)),
        };
        save(next);
        return next;
      }),
  };
});
