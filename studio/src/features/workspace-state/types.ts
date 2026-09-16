import type { TabKind, SessionId } from "../agents/types";
import type { ConfirmOptions, DialogDescriptor, ReassignOptions, ReassignResult } from "../../app/shell/dialogStore";
import type { Toast, ToastKind } from "../../app/shell/toastStore";

export type FocusedPane = "modules" | "tasks" | "details-or-terminal";

/**
 * The edit view's navigation zones. `terminal-panel` is only reachable while
 * the panel is showing: a closed panel is not a place the zone cycle can stop
 * (#669).
 */
export type EditViewZone =
  | "stories"
  | "tab-strip"
  | "active-tab-body"
  | "terminal-panel";
export type NavigationModality = "keyboard" | "pointer";
export type SelectionSurface = "backlog";

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
  modulesCursorId: string | null;

  sidebarVisible: boolean;
  panelLayout: number[] | null;

  expandedIdsByModule: Record<string, string[]>;
  collapsedStateIds: Set<string>;

  selection: {
    surface: SelectionSurface | null;
    ids: Set<string>;
    anchorId: string | null;
  };
  storySearchQuery: string;

  /** @deprecated Use the shell-owned dialog store. */
  dialogs: DialogDescriptor[];
  /** @deprecated Use the shell-owned toast store. */
  toasts: Toast[];

  /** Highest status-feed revision observed for each project. */
  workItemCursorsByProject: Record<string, number>;

  selectModule: (id: string) => Promise<void>;
  deselectModule: () => void;
  selectTask: (id: string) => void;
  toggleStateConfiguration: (projectId: string, stateId: string) => void;
  dismissStateConfiguration: () => void;
  toggleConversationConfiguration: (projectId: string, moduleId: string) => void;
  dismissConversationConfiguration: () => void;

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
  moveModulesCursor: (delta: -1 | 1, orderedIds: string[]) => void;
  setModulesCursor: (id: string | null) => void;

  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setPanelLayout: (sizes: number[]) => void;

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

  /** @deprecated Use the shell-owned dialog store. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** @deprecated Use the shell-owned dialog store. */
  reassign: (options: ReassignOptions) => Promise<ReassignResult>;
  /** @deprecated Use the shell-owned toast store. */
  pushToast: (kind: ToastKind, message: string) => number;
  /** @deprecated Use the shell-owned toast store. */
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
  | { kind: "state-configuration"; projectId: string; stateId: string }
  | { kind: "conversation-configuration"; projectId: string; moduleId: string };

export type SetWorkspaceState = (change: Partial<ClientState> | ((state: ClientState) => Partial<ClientState>)) => void;
export type GetWorkspaceState = () => ClientState;
