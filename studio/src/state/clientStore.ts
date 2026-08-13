import { create } from "zustand";
import {
  getConfigSnapshot,
  getModuleFolder,
  isSidebarEnabled,
  sidebarPaneComposition,
  updateProfile,
  type SidebarPaneComposition,
} from "../features/studio/stores/configStore";
import { useModalStore } from "../app/modal/modalStore";
import { useStudioStore } from "../features/projects";
import type {
  TabKind,
  SessionId,
} from "../features/agents/types";
import { TEMP_TASK_ID } from "../features/agents/types";
import { focusTerminal } from "../features/agents/terminal";
import {
  finishCollapsedStateMigration,
  isPanelLayout,
  persistPanelLayout,
  readCollapsedStateStorage,
  readExpandedIdsByModule,
  readPanelLayout,
  readSidebarVisible,
  readTaskSelections,
  rememberTaskSelection,
  writeCollapsedStateIds,
  writeExpandedIdsByModule,
  writeSidebarVisible,
} from "./persistence";

export type FocusedPane =
  | "projects"
  | "modules"
  | "tasks"
  | "details-or-terminal";

export type EditViewZone = "stories" | "tab-strip" | "active-tab-body";
export type NavigationModality = "keyboard" | "pointer";
export type SelectionSurface = "backlog";

export interface ModalDescriptor {
  type: string;
  payload?: Record<string, unknown>;
}

export interface KeyBinding {
  key: string;
  label: string;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface ConfirmTypedOptions extends ConfirmOptions {
  confirmText: string;
}

export interface ReassignCandidate {
  id: string;
  name: string;
}

export interface ReassignOptions {
  title: string;
  itemName: string;
  candidates: ReassignCandidate[];
}

export type ReassignResult = { reassignTo?: string } | null;

export type DialogDescriptor =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | {
      kind: "confirmTyped";
      opts: ConfirmTypedOptions;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "reassign";
      opts: ReassignOptions;
      resolve: (value: ReassignResult) => void;
    };

export type ToastKind = "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ClientState {
  selectedModuleId: string | null;
  selectedTaskId: string | null;
  workspaceSelection: WorkspaceSelection;
  workspaces: Record<string, TicketWorkspaceViewState>;
  activeByTask: Record<string, SessionId>;
  focusedPane: FocusedPane;
  editViewZone: EditViewZone;
  editViewBodyEngaged: boolean;
  navigationModality: NavigationModality;
  projectsCursorId: string | null;
  modulesCursorId: string | null;

  sidebarVisible: boolean;
  panelLayout: number[] | null;

  modalStack: ModalDescriptor[];
  bindingsStack: KeyBinding[][];

  expandedIdsByModule: Record<string, string[]>;
  collapsedStateIds: Set<string>;

  selection: {
    surface: SelectionSurface | null;
    ids: Set<string>;
    anchorId: string | null;
  };
  storySearchQuery: string;

  dialogs: DialogDescriptor[];
  toasts: Toast[];

  /** Highest status-feed revision observed for each project. */
  workItemCursorsByProject: Record<string, number>;

  selectModule: (id: string) => Promise<void>;
  selectTask: (id: string) => void;
  toggleStateConfiguration: (projectId: string, stateId: string) => void;
  dismissStateConfiguration: () => void;

  resetWorkspaces: () => void;
  ensureWorkspace: (bucket: string) => void;
  setActive: (bucket: string, active: TabKind) => void;
  setActiveDoc: (bucket: string, docId: string) => void;
  openDoc: (bucket: string, docId: string, select?: boolean) => void;
  closeDoc: (bucket: string, docId: string) => void;
  reopenDoc: (bucket: string, docId: string) => void;
  tabOpened: (bucket: string, sessionId: SessionId, select?: boolean) => void;
  tabRekeyed: (from: SessionId, to: SessionId) => void;
  tabSelected: (bucket: string, sessionId: SessionId) => void;
  tabFocused: (bucket: string, sessionId: SessionId) => void;

  focusLeft: () => void;
  focusRight: () => void;
  setFocusedPane: (pane: FocusedPane) => void;
  setEditViewZone: (zone: EditViewZone) => void;
  setEditViewBodyEngaged: (engaged: boolean) => void;
  setNavigationModality: (modality: NavigationModality) => void;
  cycleEditViewZone: () => void;
  moveProjectsCursor: (delta: -1 | 1, orderedIds: string[]) => void;
  moveModulesCursor: (delta: -1 | 1, orderedIds: string[]) => void;
  setProjectsCursor: (id: string | null) => void;
  setModulesCursor: (id: string | null) => void;

  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setPanelLayout: (sizes: number[]) => void;

  pushModal: (modal: ModalDescriptor) => void;
  popModal: () => void;
  pushBindings: (bindings: KeyBinding[]) => void;
  popBindings: () => void;

  toggleExpanded: (moduleId: string, id: string) => void;
  setExpanded: (moduleId: string, id: string, expanded: boolean) => void;
  expandMany: (moduleId: string, ids: readonly string[]) => void;
  toggleStateCollapsed: (stateId: string) => void;
  migrateCollapsedStateNames: (
    states: readonly { id?: string | null; name: string }[],
  ) => void;

  selectionToggle: (surface: SelectionSurface, id: string) => void;
  selectionRange: (
    surface: SelectionSurface,
    id: string,
    orderedIds: string[],
  ) => void;
  selectionReplace: (surface: SelectionSurface, ids: string[]) => void;
  selectionClear: () => void;
  setStorySearchQuery: (query: string) => void;

  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmTyped: (options: ConfirmTypedOptions) => Promise<boolean>;
  reassign: (options: ReassignOptions) => Promise<ReassignResult>;
  pushToast: (kind: ToastKind, message: string) => number;
  dismissToast: (id: number) => void;
  advanceWorkItemCursor: (projectId: string, revision: number) => void;
}

export interface TicketWorkspaceViewState {
  active: TabKind;
  activeDocId: string | null;
  closedDocIds: string[];
}

export type WorkspaceSelection =
  | { kind: "task" }
  | { kind: "state-configuration"; projectId: string; stateId: string };

export const DEFAULT_WORKSPACE: TicketWorkspaceViewState = {
  active: "details",
  activeDocId: null,
  closedDocIds: [],
};

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
const SUCCESS_TTL_MS = 4_000;
const ERROR_TTL_MS = 8_000;

let toastSequence = 0;
const collapsedStorage = readCollapsedStateStorage();
let pendingCollapsedStateNames = collapsedStorage.legacyNames;

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

export function resolveCursorId(
  cursorId: string | null,
  orderedIds: readonly string[],
): string | null {
  return cursorId && orderedIds.includes(cursorId)
    ? cursorId
    : orderedIds[0] ?? null;
}

function moveCursorId(
  cursorId: string | null,
  delta: -1 | 1,
  orderedIds: readonly string[],
): string | null {
  if (orderedIds.length === 0) return null;
  const index = cursorId ? orderedIds.indexOf(cursorId) : -1;
  if (index === -1) return orderedIds[0];
  return orderedIds[Math.max(0, Math.min(index + delta, orderedIds.length - 1))];
}

function hasProject(): boolean {
  return useStudioStore.getState().selectedProjectId !== null;
}

function currentSidebarPaneComposition(): SidebarPaneComposition {
  const config = getConfigSnapshot();
  return sidebarPaneComposition(
    config.features.projects,
    isSidebarEnabled(config),
  );
}

function nextExpandedMap(
  current: Readonly<Record<string, string[]>>,
  moduleId: string,
  update: (ids: Set<string>) => void,
): Record<string, string[]> {
  const ids = new Set(current[moduleId] ?? []);
  update(ids);
  return { ...current, [moduleId]: [...ids] };
}

export const useClientStore = create<ClientState>((set, get) => ({
  selectedModuleId: null,
  selectedTaskId: null,
  workspaceSelection: { kind: "task" },
  workspaces: {},
  activeByTask: {},
  focusedPane: "tasks",
  editViewZone: "stories",
  editViewBodyEngaged: false,
  navigationModality: "keyboard",
  projectsCursorId: null,
  modulesCursorId: null,
  sidebarVisible: readSidebarVisible(),
  panelLayout: readPanelLayout(),
  modalStack: [],
  bindingsStack: [DEFAULT_BINDINGS],
  expandedIdsByModule: readExpandedIdsByModule(),
  collapsedStateIds: collapsedStorage.ids,
  selection: { surface: null, ids: new Set(), anchorId: null },
  storySearchQuery: "",
  dialogs: [],
  toasts: [],
  workItemCursorsByProject: {},

  async selectModule(id) {
    const projectId = useStudioStore.getState().selectedProjectId;
    if (!projectId) return;
    const { recentProfileIndex, profiles } = getConfigSnapshot();
    const profile =
      recentProfileIndex === null ? undefined : profiles[recentProfileIndex];
    if (!getModuleFolder(profile, id)) {
      useModalStore.getState().pushModal({
        type: "module-folder",
        payload: { moduleId: id, resumeModuleSelection: true },
      });
      return;
    }
    set({
      selectedModuleId: id,
      selectedTaskId: null,
      workspaceSelection: { kind: "task" },
    });
    const { loadModuleTree } = await import("../features/work-items");
    const persistRecentModule =
      profile && profile.recent_module_ids?.[projectId] !== id
        ? updateProfile(recentProfileIndex!, {
            ...profile,
            recent_project_id: projectId,
            recent_module_ids: {
              ...(profile.recent_module_ids ?? {}),
              [projectId]: id,
            },
          }).catch((error) => {
            console.warn("[clientStore] persist recent module failed", error);
          })
        : Promise.resolve();
    const [tree] = await Promise.all([
      loadModuleTree(projectId, id),
      persistRecentModule,
    ]);
    if (
      useStudioStore.getState().selectedProjectId !== projectId ||
      get().selectedModuleId !== id
    ) return;
    const rememberedTaskId = readTaskSelections()[id];
    const loadedTaskIds = new Set(tree.order);
    const isSelectableTaskId = (taskId: string) =>
      taskId === TEMP_TASK_ID || loadedTaskIds.has(taskId);
    set((state) => ({
      selectedTaskId:
        state.selectedTaskId && isSelectableTaskId(state.selectedTaskId)
          ? state.selectedTaskId
          : rememberedTaskId && isSelectableTaskId(rememberedTaskId)
            ? rememberedTaskId
            : null,
    }));
    get().setSidebarVisible(false);
    get().setFocusedPane("tasks");
  },

  selectTask(id) {
    set({ selectedTaskId: id, workspaceSelection: { kind: "task" } });
  },

  toggleStateConfiguration(projectId, stateId) {
    set((state) => ({
      workspaceSelection:
        state.workspaceSelection.kind === "state-configuration" &&
        state.workspaceSelection.projectId === projectId &&
        state.workspaceSelection.stateId === stateId
          ? { kind: "task" }
          : { kind: "state-configuration", projectId, stateId },
    }));
  },

  dismissStateConfiguration() {
    set({ workspaceSelection: { kind: "task" } });
  },

  resetWorkspaces() {
    set({ workspaces: {} });
  },

  ensureWorkspace(bucket) {
    if (get().workspaces[bucket]) return;
    set((state) => ({
      workspaces: { ...state.workspaces, [bucket]: { ...DEFAULT_WORKSPACE } },
    }));
  },

  setActive(bucket, active) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return { workspaces: { ...state.workspaces, [bucket]: { ...current, active } } };
    });
  },

  setActiveDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return { workspaces: { ...state.workspaces, [bucket]: {
        ...current, active: "doc", activeDocId: docId,
      } } };
    });
  },

  openDoc(bucket, docId, select = true) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      const closedDocIds = current.closedDocIds.filter((id) => id !== docId);
      return { workspaces: { ...state.workspaces, [bucket]: select
        ? { ...current, closedDocIds, active: "doc", activeDocId: docId }
        : { ...current, closedDocIds } } };
    });
  },

  closeDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return { workspaces: { ...state.workspaces, [bucket]: {
        ...current,
        closedDocIds: [...new Set([...current.closedDocIds, docId])],
      } } };
    });
  },

  reopenDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return { workspaces: { ...state.workspaces, [bucket]: {
        ...current,
        closedDocIds: current.closedDocIds.filter((id) => id !== docId),
        active: "doc", activeDocId: docId,
      } } };
    });
  },

  tabOpened(bucket, sessionId, select = true) {
    set((state) => ({
      activeByTask: select || state.activeByTask[bucket] === undefined
        ? { ...state.activeByTask, [bucket]: sessionId }
        : state.activeByTask,
    }));
  },

  tabRekeyed(from, to) {
    if (from === to) return;
    set((state) => ({
      activeByTask: Object.fromEntries(Object.entries(state.activeByTask).map(
        ([bucket, id]) => [bucket, id === from ? to : id],
      )),
    }));
  },

  tabSelected(bucket, sessionId) {
    set((state) => ({ activeByTask: { ...state.activeByTask, [bucket]: sessionId } }));
  },

  tabFocused(bucket, sessionId) {
    set((state) => ({ activeByTask: { ...state.activeByTask, [bucket]: sessionId } }));
    focusTerminal(sessionId);
  },

  focusLeft() {
    const { focusedPane, sidebarVisible } = get();
    const hasSelectedProject = hasProject();
    const paneComposition = currentSidebarPaneComposition();
    const order = visiblePaneOrder(
      sidebarVisible,
      hasSelectedProject,
      paneComposition,
    );
    const index = order.indexOf(focusedPane);
    if (index > 0) {
      set({ focusedPane: order[index - 1] });
      return;
    }
    if (!sidebarVisible && paneComposition !== "absent") {
      writeSidebarVisible(true);
      set({
        sidebarVisible: true,
        focusedPane:
          hasSelectedProject || paneComposition === "modules"
            ? "modules"
            : "projects",
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
    const index = order.indexOf(focusedPane);
    if (index >= 0 && index < order.length - 1) {
      set({ focusedPane: order[index + 1] });
    }
  },

  setFocusedPane(focusedPane) {
    set({ focusedPane });
  },

  setEditViewZone(editViewZone) {
    set((state) => ({
      editViewZone,
      editViewBodyEngaged:
        editViewZone === "active-tab-body" && state.editViewZone === editViewZone
          ? state.editViewBodyEngaged
          : false,
      focusedPane:
        editViewZone === "stories" ? "tasks" : "details-or-terminal",
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

  setNavigationModality(navigationModality) {
    set({ navigationModality });
  },

  cycleEditViewZone() {
    const order: EditViewZone[] = ["stories", "tab-strip", "active-tab-body"];
    const editViewZone = order[(order.indexOf(get().editViewZone) + 1) % order.length];
    set({
      editViewZone,
      editViewBodyEngaged: false,
      focusedPane:
        editViewZone === "stories" ? "tasks" : "details-or-terminal",
    });
  },

  moveProjectsCursor(delta, orderedIds) {
    set((state) => ({
      projectsCursorId: moveCursorId(state.projectsCursorId, delta, orderedIds),
    }));
  },

  moveModulesCursor(delta, orderedIds) {
    set((state) => ({
      modulesCursorId: moveCursorId(state.modulesCursorId, delta, orderedIds),
    }));
  },

  setProjectsCursor(projectsCursorId) {
    set({ projectsCursorId });
  },

  setModulesCursor(modulesCursorId) {
    set({ modulesCursorId });
  },

  toggleSidebar() {
    get().setSidebarVisible(!get().sidebarVisible);
  },

  setSidebarVisible(sidebarVisible) {
    writeSidebarVisible(sidebarVisible);
    set(
      sidebarVisible
        ? { sidebarVisible: true, editViewBodyEngaged: false }
        : {
            sidebarVisible: false,
            editViewZone: "stories",
            editViewBodyEngaged: false,
            focusedPane: "tasks",
          },
    );
  },

  setPanelLayout(panelLayout) {
    if (!isPanelLayout(panelLayout)) return;
    persistPanelLayout(panelLayout);
    set({ panelLayout });
  },

  pushModal(modal) {
    set((state) => ({ modalStack: [...state.modalStack, modal] }));
  },

  popModal() {
    set((state) => ({ modalStack: state.modalStack.slice(0, -1) }));
  },

  pushBindings(bindings) {
    set((state) => ({ bindingsStack: [...state.bindingsStack, bindings] }));
  },

  popBindings() {
    set((state) => ({
      bindingsStack:
        state.bindingsStack.length > 1
          ? state.bindingsStack.slice(0, -1)
          : state.bindingsStack,
    }));
  },

  toggleExpanded(moduleId, id) {
    set((state) => {
      const expandedIdsByModule = nextExpandedMap(
        state.expandedIdsByModule,
        moduleId,
        (ids) => (ids.has(id) ? ids.delete(id) : ids.add(id)),
      );
      writeExpandedIdsByModule(expandedIdsByModule);
      return { expandedIdsByModule };
    });
  },

  setExpanded(moduleId, id, expanded) {
    set((state) => {
      const expandedIdsByModule = nextExpandedMap(
        state.expandedIdsByModule,
        moduleId,
        (ids) => (expanded ? ids.add(id) : ids.delete(id)),
      );
      writeExpandedIdsByModule(expandedIdsByModule);
      return { expandedIdsByModule };
    });
  },

  expandMany(moduleId, newIds) {
    set((state) => {
      const expandedIdsByModule = nextExpandedMap(
        state.expandedIdsByModule,
        moduleId,
        (ids) => newIds.forEach((id) => ids.add(id)),
      );
      writeExpandedIdsByModule(expandedIdsByModule);
      return { expandedIdsByModule };
    });
  },

  toggleStateCollapsed(stateId) {
    set((state) => {
      const collapsedStateIds = new Set(state.collapsedStateIds);
      if (collapsedStateIds.has(stateId)) collapsedStateIds.delete(stateId);
      else collapsedStateIds.add(stateId);
      writeCollapsedStateIds(collapsedStateIds);
      return { collapsedStateIds };
    });
  },

  migrateCollapsedStateNames(states) {
    if (pendingCollapsedStateNames === null) return;
    const idByName = new Map(
      states.flatMap((state) =>
        state.id ? [[state.name, state.id] as const] : [],
      ),
    );
    const collapsedStateIds = new Set(
      pendingCollapsedStateNames.flatMap((name) => {
        const id = idByName.get(name);
        return id ? [id] : [];
      }),
    );
    pendingCollapsedStateNames = null;
    finishCollapsedStateMigration(collapsedStateIds);
    set({ collapsedStateIds });
  },

  selectionToggle(surface, id) {
    const current = get().selection;
    const ids = current.surface === surface
      ? new Set(current.ids)
      : new Set<string>();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    set({ selection: { surface, ids, anchorId: id } });
  },

  selectionRange(surface, id, orderedIds) {
    const current = get().selection;
    if (current.surface !== surface || current.anchorId === null) {
      get().selectionToggle(surface, id);
      return;
    }
    const anchorIndex = orderedIds.indexOf(current.anchorId);
    const targetIndex = orderedIds.indexOf(id);
    if (anchorIndex === -1 || targetIndex === -1) {
      get().selectionToggle(surface, id);
      return;
    }
    const [start, end] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const ids = new Set(current.ids);
    for (let index = start; index <= end; index += 1) ids.add(orderedIds[index]);
    set({ selection: { ...current, ids } });
  },

  selectionReplace(surface, ids) {
    set({ selection: { surface, ids: new Set(ids), anchorId: null } });
  },

  selectionClear() {
    set({ selection: { surface: null, ids: new Set(), anchorId: null } });
  },

  setStorySearchQuery(storySearchQuery) {
    set({ storySearchQuery });
  },

  confirm(options) {
    return new Promise<boolean>((resolve) => {
      const descriptor: DialogDescriptor = {
        kind: "confirm",
        opts: options,
        resolve: (value) => {
          set((state) => ({ dialogs: state.dialogs.filter((item) => item !== descriptor) }));
          resolve(value);
        },
      };
      set((state) => ({ dialogs: [...state.dialogs, descriptor] }));
    });
  },

  confirmTyped(options) {
    return new Promise<boolean>((resolve) => {
      const descriptor: DialogDescriptor = {
        kind: "confirmTyped",
        opts: options,
        resolve: (value) => {
          set((state) => ({ dialogs: state.dialogs.filter((item) => item !== descriptor) }));
          resolve(value);
        },
      };
      set((state) => ({ dialogs: [...state.dialogs, descriptor] }));
    });
  },

  reassign(options) {
    return new Promise<ReassignResult>((resolve) => {
      const descriptor: DialogDescriptor = {
        kind: "reassign",
        opts: options,
        resolve: (value) => {
          set((state) => ({ dialogs: state.dialogs.filter((item) => item !== descriptor) }));
          resolve(value);
        },
      };
      set((state) => ({ dialogs: [...state.dialogs, descriptor] }));
    });
  },

  pushToast(kind, message) {
    const id = ++toastSequence;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    setTimeout(
      () => get().dismissToast(id),
      kind === "error" ? ERROR_TTL_MS : SUCCESS_TTL_MS,
    );
    return id;
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  advanceWorkItemCursor(projectId, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    set((state) => {
      if ((state.workItemCursorsByProject[projectId] ?? -1) >= revision) {
        return state;
      }
      return {
        workItemCursorsByProject: {
          ...state.workItemCursorsByProject,
          [projectId]: revision,
        },
      };
    });
  },
}));

useClientStore.subscribe((state, previous) => {
  if (
    !state.selectedModuleId ||
    !state.selectedTaskId ||
    (state.selectedModuleId === previous.selectedModuleId &&
      state.selectedTaskId === previous.selectedTaskId)
  ) {
    return;
  }
  rememberTaskSelection(state.selectedModuleId, state.selectedTaskId);
});

export const dialog = {
  confirm: (options: ConfirmOptions) => useClientStore.getState().confirm(options),
  confirmTyped: (options: ConfirmTypedOptions) =>
    useClientStore.getState().confirmTyped(options),
  reassign: (options: ReassignOptions) =>
    useClientStore.getState().reassign(options),
};

export const toast = {
  success: (message: string) =>
    useClientStore.getState().pushToast("success", message),
  error: (message: string) =>
    useClientStore.getState().pushToast("error", message),
};
