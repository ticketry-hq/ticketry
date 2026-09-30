import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
import { useStudioStore } from "../projects";
import { isTerminalPanelOpen, useTerminalPanelStore } from "../terminal-panel/panelStore";
import { writeSidebarVisible, isPanelLayout, persistPanelLayout } from "../../state/persistence";
import type { FocusedPane, EditViewZone } from "./types";
const PANE_ORDER: FocusedPane[] = ["modules", "tasks", "details-or-terminal"];
const BASE_EDIT_VIEW_ZONES: EditViewZone[] = [
  "stories",
  "tab-strip",
  "active-tab-body",
];

/**
 * The zones `Shift+Tab` walks. The terminal panel joins as a fourth zone only
 * while it is showing, so the cycle never stops on a surface nobody can see.
 */
export function editViewZoneOrder(): EditViewZone[] {
  return isTerminalPanelOpen()
    ? [...BASE_EDIT_VIEW_ZONES, "terminal-panel"]
    : BASE_EDIT_VIEW_ZONES;
}

/** Zones whose contents can take the keyboard outright (terminal typing mode). */
export function isEngageableZone(zone: EditViewZone): boolean {
  return zone === "active-tab-body" || zone === "terminal-panel";
}

function zoneEntryEngagement(
  state: { editViewZone: EditViewZone; editViewBodyEngaged: boolean; sidebarVisible: boolean },
  entering: EditViewZone,
): boolean {
  const inEditView = !state.sidebarVisible;
  // The panel holds nothing but a shell, so entering it commits to typing.
  if (entering === "terminal-panel") return inEditView;
  if (entering === "active-tab-body" && state.editViewZone === entering) {
    return state.editViewBodyEngaged;
  }
  return false;
}

/**
 * The panes a person can move focus between, left to right.
 *
 * The sidebar holds one pane — the installation project's modules — because
 * there is one project and therefore nothing to choose between. Hiding the
 * sidebar leaves the edit view's two panes.
 */
export function visiblePaneOrder(
  sidebarVisible: boolean,
  hasSelectedProject: boolean,
): FocusedPane[] {
  if (!sidebarVisible) return ["tasks", "details-or-terminal"];
  return PANE_ORDER.filter(
    (pane) => hasSelectedProject || pane !== "modules",
  );
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



export function navigationActions(set: SetWorkspaceState, get: GetWorkspaceState): Pick<ClientState,
  | "focusLeft"
  | "focusRight"
  | "setFocusedPane"
  | "setEditViewZone"
  | "setEditViewBodyEngaged"
  | "setNavigationModality"
  | "cycleEditViewZone"
  | "moveModulesCursor"
  | "setModulesCursor"
  | "toggleSidebar"
  | "setSidebarVisible"
  | "setPanelLayout"
> {
  return {
    focusLeft() {
      const { focusedPane, sidebarVisible } = get();
      const order = visiblePaneOrder(sidebarVisible, hasProject());
      const index = order.indexOf(focusedPane);
      if (index > 0) {
        set({ focusedPane: order[index - 1] });
        return;
      }
      if (!sidebarVisible) {
        writeSidebarVisible(true);
        set({ sidebarVisible: true, focusedPane: "modules" });
      }
    },

    focusRight() {
      const { focusedPane, sidebarVisible } = get();
      const order = visiblePaneOrder(sidebarVisible, hasProject());
      const index = order.indexOf(focusedPane);
      if (index >= 0 && index < order.length - 1) {
        set({ focusedPane: order[index + 1] });
      }
    },

    setFocusedPane(focusedPane) {
      set({ focusedPane });
    },

    setEditViewZone(editViewZone) {
      const editViewBodyEngaged = zoneEntryEngagement(get(), editViewZone);
      set({
        editViewZone,
        editViewBodyEngaged,
        focusedPane:
          editViewZone === "stories" ? "tasks" : "details-or-terminal",
      });
      // Reaching the panel puts the keyboard in its shell, because typing is the
      // only thing the panel is for.
      if (editViewZone === "terminal-panel" && editViewBodyEngaged) {
        useTerminalPanelStore.getState().focusShell();
      }
    },

    setEditViewBodyEngaged(engaged) {
      const state = get();
      set({
        editViewBodyEngaged:
          engaged && !state.sidebarVisible && isEngageableZone(state.editViewZone),
      });
    },

    setNavigationModality(navigationModality) {
      set({ navigationModality });
    },

    cycleEditViewZone() {
      const order = editViewZoneOrder();
      const next = (order.indexOf(get().editViewZone) + 1) % order.length;
      get().setEditViewZone(order[next]);
    },

    moveModulesCursor(delta, orderedIds) {
      set((state) => ({
        modulesCursorId: moveCursorId(state.modulesCursorId, delta, orderedIds),
      }));
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
          ? {
              sidebarVisible: true,
              editViewBodyEngaged: false,
              focusedPane: "modules",
            }
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

  };
}
