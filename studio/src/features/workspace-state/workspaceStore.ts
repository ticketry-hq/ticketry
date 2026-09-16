import { createApolloStore } from "../../shared/apollo/localState";
import { readSidebarVisible, readPanelLayout, readExpandedIdsByModule, rememberTaskSelection } from "../../state/persistence";
import type { ClientState } from "./types";
import { moduleSelectionActions } from "./moduleSelection";
import { workspaceTabActions } from "./workspaceTabs";
import { navigationActions } from "./navigation";
import { initialCollapsedStateIds, rowExpansionActions } from "./rowExpansion";
import { taskSelectionActions } from "./taskSelection";
import { statusCursorActions } from "./statusCursor";
import { shellCompatibility } from "./shellCompatibility";

export type * from "./types";
export { DEFAULT_WORKSPACE } from "./workspaceTabs";
export { editViewZoneOrder, isEngageableZone, visiblePaneOrder, resolveCursorId } from "./navigation";

export const useClientStore = createApolloStore<ClientState>("client", (set, get) => ({
  selectedModuleId: null,
  selectedTaskId: null,
  workspaceSelection: { kind: "task" },
  workspaces: {},
  activeByTask: {},
  focusedPane: "tasks",
  editViewZone: "stories",
  editViewBodyEngaged: false,
  navigationModality: "keyboard",
  modulesCursorId: null,
  sidebarVisible: readSidebarVisible(),
  panelLayout: readPanelLayout(),
  expandedIdsByModule: readExpandedIdsByModule(),
  collapsedStateIds: initialCollapsedStateIds,
  selection: { surface: null, ids: new Set(), anchorId: null },
  storySearchQuery: "",
  workItemCursorsByProject: {},

  ...moduleSelectionActions(set, get),
  ...workspaceTabActions(set, get),
  ...navigationActions(set, get),
  ...rowExpansionActions(set, get),
  ...taskSelectionActions(set, get),
  ...statusCursorActions(set, get),
} as ClientState), shellCompatibility);

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

// Compatibility exports while feature callers move to their shell-owned stores.
export { dialog } from "../../app/shell/dialogStore";
export { toast } from "../../app/shell/toastStore";
