import { create } from "zustand";
import type { TaskId } from "../lib/types";
import {
  getPanelWidths,
  putPanelWidths,
  getExpandedSubtasks,
  putExpandedSubtasks,
} from "../lib/api";
import { taskRevealPath } from "../lib/taskTree";
import {
  isSidebarEnabled,
  sidebarPaneComposition,
  type SidebarPaneComposition,
  useConfigStore,
} from "./configStore";
import { useTasksStore } from "./tasksStore";
import { readVersionedItem } from "../../../shared/storage/versioned";

export type FocusedPane =
  | "projects"
  | "modules"
  | "tasks"
  | "details-or-terminal";

export type EditViewZone = "stories" | "tab-strip" | "active-tab-body";
export type NavigationModality = "keyboard" | "pointer";

export interface ModalDescriptor {
  type: string;
  payload?: Record<string, unknown>;
}

export interface KeyBinding {
  key: string;
  label: string;
}

// Versioned keys (client-localstorage-schema); reads migrate the legacy
// plane-tui spellings once.
const SIDEBAR_KEY = "studio.sidebarVisible:v1";
const LEGACY_SIDEBAR_KEYS = ["plane-tui:sidebar-visible"];
const LAYOUT_KEY = "studio.panelLayout:v1";
const LEGACY_LAYOUT_KEYS = ["plane-tui:panel-layout"];
const COLLAPSED_STATES_KEY = "studio.collapsedStates:v1";
const LEGACY_COLLAPSED_STATES_KEYS = ["plane-tui:collapsed-states"];
const PANEL_LAYOUT_SAVE_DELAY_MS = 400;

let panelLayoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
let expandedHydrationGeneration = 0;

function readSidebar(): boolean {
  const v = readVersionedItem(SIDEBAR_KEY, LEGACY_SIDEBAR_KEYS);
  if (v === null) return true;
  return v === "true";
}

// Which workflow-state sections the user has collapsed in the Tasks pane,
// keyed by state name (e.g. "Done"). Persisted globally so a state the user
// unfocuses stays collapsed across modules and reloads.
function readCollapsedStates(): Set<string> {
  try {
    const v = readVersionedItem(
      COLLAPSED_STATES_KEY,
      LEGACY_COLLAPSED_STATES_KEYS,
    );
    if (!v) return new Set();
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "string")) {
      return new Set(parsed as string[]);
    }
  } catch {
    /* ignore unavailable/corrupt storage */
  }
  return new Set();
}

function writeCollapsedStates(names: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STATES_KEY, JSON.stringify([...names]));
  } catch {
    /* ignore */
  }
}

function readLayout(): number[] | null {
  try {
    const v = readVersionedItem(LAYOUT_KEY, LEGACY_LAYOUT_KEYS);
    if (!v) return null;
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
      return parsed as number[];
    }
    return null;
  } catch {
    return null;
  }
}

function isPanelLayout(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function writeLayout(sizes: number[]): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(sizes));
  } catch {
    /* ignore */
  }
}

function persistPanelLayout(sizes: number[]): void {
  if (panelLayoutSaveTimer !== null) {
    clearTimeout(panelLayoutSaveTimer);
  }
  panelLayoutSaveTimer = setTimeout(() => {
    panelLayoutSaveTimer = null;
    void putPanelWidths(sizes).catch((err) => {
      console.warn("[uiStore] panel layout persist failed", err);
    });
  }, PANEL_LAYOUT_SAVE_DELAY_MS);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Fire-and-forget write of the expanded set for one module. Kept side-effect
// free (no focus/selection changes) to avoid the #435 collapse-handler
// regression where toggling rippled into unrelated UI.
function persistExpanded(moduleId: string, ids: string[]): void {
  void putExpandedSubtasks(moduleId, ids).catch((err) => {
    console.warn("[uiStore] expanded subtasks persist failed", err);
  });
}

function selectedTaskAncestorIds(moduleId: string): Set<TaskId> {
  const { selectedModuleId, selectedTaskId, tasks, subtasks } =
    useTasksStore.getState();
  if (selectedModuleId !== moduleId || !selectedTaskId) return new Set();
  return taskRevealPath(selectedTaskId, moduleId, tasks, subtasks).ancestorIds;
}

export const DEFAULT_BINDINGS: KeyBinding[] = [
  { key: "o", label: "Open Agent" },
  { key: "n", label: "Plan" },
  { key: "i", label: "Instant Change" },
  { key: "s", label: "Status" },
  { key: "e", label: "Settings" },
  { key: "f", label: "Set Folder" },
  { key: "q", label: "Close Tab" },
  { key: "⌘\\", label: "Next Terminal" },
  { key: "⌘⇧\\", label: "Previous Terminal" },
  { key: "\\", label: "Sidebar" },
];

const PANE_ORDER: FocusedPane[] = [
  "projects",
  "modules",
  "tasks",
  "details-or-terminal",
];

interface UIStoreState {
  focusedPane: FocusedPane;
  editViewZone: EditViewZone;
  editViewBodyEngaged: boolean;
  navigationModality: NavigationModality;
  sidebarVisible: boolean;
  panelLayout: number[] | null;
  modalStack: ModalDescriptor[];
  activeBindings: KeyBinding[];
  bindingsStack: KeyBinding[][];
  expandedTaskIds: Set<TaskId>;
  expandedModuleId: string | null;
  collapsedStateNames: Set<string>;
  storySearchQuery: string;
  projectsCursor: number;
  modulesCursor: number;

  focusLeft: () => void;
  focusRight: () => void;
  setFocusedPane: (p: FocusedPane) => void;
  setEditViewZone: (zone: EditViewZone) => void;
  setEditViewBodyEngaged: (engaged: boolean) => void;
  setNavigationModality: (modality: NavigationModality) => void;
  cycleEditViewZone: () => void;
  toggleSidebar: () => void;
  setSidebarVisible: (v: boolean) => void;
  pushModal: (m: ModalDescriptor) => void;
  popModal: () => void;
  pushBindings: (arr: KeyBinding[]) => void;
  popBindings: () => void;
  hydratePanelLayout: () => Promise<number[] | null>;
  setPanelLayout: (sizes: number[]) => void;
  toggleExpanded: (taskId: TaskId) => void;
  setExpanded: (taskId: TaskId, expanded: boolean) => void;
  expandTasks: (taskIds: readonly TaskId[]) => void;
  hydrateExpandedForModule: (moduleId: string) => Promise<void>;
  toggleStateCollapsed: (stateName: string) => void;
  renameCollapsedState: (previousName: string, nextName: string) => void;
  setStorySearchQuery: (query: string) => void;
}

export function visiblePaneOrder(
  sidebarVisible: boolean,
  hasSelectedProject: boolean,
  paneComposition: SidebarPaneComposition,
): FocusedPane[] {
  if (!sidebarVisible) return ["tasks", "details-or-terminal"];

  switch (paneComposition) {
    case "absent":
      return ["tasks", "details-or-terminal"];
    case "modules":
      return PANE_ORDER.filter(
        (pane) => pane !== "projects" && (hasSelectedProject || pane !== "modules"),
      );
    case "projects-and-modules":
      return PANE_ORDER.filter(
        (pane) => hasSelectedProject || pane !== "modules",
      );
  }
}

function hasProject(): boolean {
  return useTasksStore.getState().selectedProjectId != null;
}

function currentSidebarPaneComposition(): SidebarPaneComposition {
  const config = useConfigStore.getState();
  return sidebarPaneComposition(
    config.features.projects,
    isSidebarEnabled(config),
  );
}

export const useUIStore = create<UIStoreState>((set, get) => ({
  focusedPane: "tasks",
  editViewZone: "stories",
  editViewBodyEngaged: false,
  navigationModality: "keyboard",
  sidebarVisible: readSidebar(),
  panelLayout: readLayout(),
  modalStack: [],
  activeBindings: DEFAULT_BINDINGS,
  bindingsStack: [],
  expandedTaskIds: new Set<TaskId>(),
  expandedModuleId: null,
  collapsedStateNames: readCollapsedStates(),
  storySearchQuery: "",
  projectsCursor: 0,
  modulesCursor: 0,

  focusLeft() {
    const { focusedPane, sidebarVisible } = get();
    const hasProj = hasProject();
    const paneComposition = currentSidebarPaneComposition();
    const order = visiblePaneOrder(
      sidebarVisible,
      hasProj,
      paneComposition,
    );
    const idx = order.indexOf(focusedPane);
    if (idx > 0) {
      set({ focusedPane: order[idx - 1] });
      return;
    }
    // At (or past) leftmost visible: if sidebar is collapsed, re-show it and
    // jump focus to Modules (or Projects if no project). Mirrors TUI
    // action_focus_left's re-show clause.
    if (!sidebarVisible && paneComposition !== "absent") {
      try {
        localStorage.setItem(SIDEBAR_KEY, "true");
      } catch {
        /* ignore */
      }
      set({
        sidebarVisible: true,
        focusedPane:
          hasProj || paneComposition === "modules" ? "modules" : "projects",
      });
    }
  },

  focusRight() {
    const { focusedPane, sidebarVisible } = get();
    const order = visiblePaneOrder(
      sidebarVisible,
      hasProject(),
      currentSidebarPaneComposition(),
    );
    const idx = order.indexOf(focusedPane);
    if (idx >= 0 && idx < order.length - 1) {
      set({ focusedPane: order[idx + 1] });
    }
  },

  setFocusedPane(p) {
    set({ focusedPane: p });
  },

  setEditViewZone(zone) {
    set((state) => ({
      editViewZone: zone,
      editViewBodyEngaged:
        zone === "active-tab-body" && state.editViewZone === zone
          ? state.editViewBodyEngaged
          : false,
      focusedPane: zone === "stories" ? "tasks" : "details-or-terminal",
    }));
  },

  setEditViewBodyEngaged(engaged) {
    const state = get();
    set({
      editViewBodyEngaged:
        engaged &&
        (!isSidebarEnabled() || !state.sidebarVisible) &&
        state.editViewZone === "active-tab-body",
    });
  },

  setNavigationModality(modality) {
    set({ navigationModality: modality });
  },

  cycleEditViewZone() {
    const order: EditViewZone[] = [
      "stories",
      "tab-strip",
      "active-tab-body",
    ];
    const current = order.indexOf(get().editViewZone);
    const editViewZone = order[(current + 1) % order.length];
    set({
      editViewZone,
      editViewBodyEngaged: false,
      focusedPane:
        editViewZone === "stories" ? "tasks" : "details-or-terminal",
    });
  },

  toggleSidebar() {
    const next = !get().sidebarVisible;
    try {
      localStorage.setItem(SIDEBAR_KEY, String(next));
    } catch {
      /* ignore */
    }
    set(
      next
        ? { sidebarVisible: true, editViewBodyEngaged: false }
        : {
            sidebarVisible: false,
            editViewZone: "stories",
            editViewBodyEngaged: false,
            focusedPane: "tasks",
          },
    );
  },

  setSidebarVisible(v) {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(v));
    } catch {
      /* ignore */
    }
    set(
      v
        ? { sidebarVisible: true, editViewBodyEngaged: false }
        : {
            sidebarVisible: false,
            editViewZone: "stories",
            editViewBodyEngaged: false,
            focusedPane: "tasks",
          },
    );
  },

  pushModal(m) {
    set((s) => ({ modalStack: [...s.modalStack, m] }));
  },

  popModal() {
    set((s) => ({ modalStack: s.modalStack.slice(0, -1) }));
  },

  pushBindings(arr) {
    set((s) => ({
      bindingsStack: [...s.bindingsStack, s.activeBindings],
      activeBindings: arr,
    }));
  },

  popBindings() {
    set((s) => {
      const stack = [...s.bindingsStack];
      const prev = stack.pop() ?? DEFAULT_BINDINGS;
      return { bindingsStack: stack, activeBindings: prev };
    });
  },

  async hydratePanelLayout() {
    try {
      const { value } = await getPanelWidths();
      if (!isPanelLayout(value)) {
        return null;
      }
      writeLayout(value);
      set({ panelLayout: value });
      return value;
    } catch (err) {
      console.warn("[uiStore] panel layout hydrate failed", err);
      return null;
    }
  },

  setPanelLayout(sizes) {
    if (!isPanelLayout(sizes)) {
      return;
    }
    writeLayout(sizes);
    persistPanelLayout(sizes);
    set({ panelLayout: sizes });
  },

  toggleExpanded(taskId) {
    set((s) => {
      const next = new Set(s.expandedTaskIds);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      // Write on every toggle, scoped to the loaded module.
      if (s.expandedModuleId) {
        persistExpanded(s.expandedModuleId, Array.from(next));
      }
      return { expandedTaskIds: next };
    });
  },

  setExpanded(taskId, expanded) {
    set((s) => {
      const next = new Set(s.expandedTaskIds);
      if (expanded) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      // Write on every toggle, scoped to the loaded module.
      if (s.expandedModuleId) {
        persistExpanded(s.expandedModuleId, Array.from(next));
      }
      return { expandedTaskIds: next };
    });
  },

  expandTasks(taskIds) {
    set((s) => {
      const next = new Set(s.expandedTaskIds);
      let changed = false;
      for (const taskId of taskIds) {
        if (next.has(taskId)) continue;
        next.add(taskId);
        changed = true;
      }
      if (!changed) return s;
      if (s.expandedModuleId) {
        persistExpanded(s.expandedModuleId, Array.from(next));
      }
      return { expandedTaskIds: next };
    });
  },

  toggleStateCollapsed(stateName) {
    set((s) => {
      const next = new Set(s.collapsedStateNames);
      if (next.has(stateName)) {
        next.delete(stateName);
      } else {
        next.add(stateName);
      }
      writeCollapsedStates(next);
      return { collapsedStateNames: next };
    });
  },

  renameCollapsedState(previousName, nextName) {
    if (previousName === nextName) return;
    set((s) => {
      if (!s.collapsedStateNames.has(previousName)) return s;
      const next = new Set(
        [...s.collapsedStateNames].map((name) =>
          name === previousName ? nextName : name),
      );
      writeCollapsedStates(next);
      return { collapsedStateNames: next };
    });
  },

  async hydrateExpandedForModule(moduleId) {
    const generation = ++expandedHydrationGeneration;
    const required = selectedTaskAncestorIds(moduleId);
    // Reflect the module switch immediately: bind the new scope and clear the
    // prior module's set so collapsed sets never mix across modules.
    set({ expandedModuleId: moduleId, expandedTaskIds: required });

    let value: unknown;
    try {
      ({ value } = await getExpandedSubtasks(moduleId));
    } catch (err) {
      console.warn("[uiStore] expanded subtasks hydrate failed", err);
      return;
    }

    // A newer module switch may have landed while awaiting; drop stale results.
    if (
      generation !== expandedHydrationGeneration ||
      get().expandedModuleId !== moduleId ||
      useTasksStore.getState().selectedModuleId !== moduleId
    ) {
      return;
    }
    if (!isStringArray(value)) {
      return;
    }

    set({ expandedTaskIds: new Set<TaskId>([...value, ...required]) });
  },

  setStorySearchQuery(query) {
    set({ storySearchQuery: query });
  },
}));
