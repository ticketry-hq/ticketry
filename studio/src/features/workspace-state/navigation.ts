import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
import { isTerminalPanelOpen, useTerminalPanelStore } from "../terminal-panel/panelStore";
import { normalizePanelLayout, persistPanelLayout } from "../../state/persistence";
import type { FocusedPane, EditViewZone } from "./types";
import { toggleModuleManager } from "../module-manager/state";
const PANE_ORDER: FocusedPane[] = ["tasks", "details-or-terminal"];
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
  state: { editViewZone: EditViewZone; editViewBodyEngaged: boolean },
  entering: EditViewZone,
): boolean {
  // The panel holds nothing but a shell, so entering it commits to typing.
  if (entering === "terminal-panel") return true;
  if (entering === "active-tab-body" && state.editViewZone === entering) {
    return state.editViewBodyEngaged;
  }
  return false;
}

/** The remaining workspace panes; legacy sidebar flags have no effect. */
export function visiblePaneOrder(_sidebarVisible?: boolean, _hasSelectedProject?: boolean): FocusedPane[] {
  return PANE_ORDER;
}

export function resolveCursorId(
  cursorId: string | null,
  orderedIds: readonly string[],
): string | null {
  return cursorId && orderedIds.includes(cursorId)
    ? cursorId
    : orderedIds[0] ?? null;
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
      get().setEditViewZone("stories");
    },

    focusRight() {
      get().setEditViewZone("active-tab-body");
    },

    setFocusedPane(focusedPane) {
      if (focusedPane === "modules") {
        get().setEditViewZone("stories");
        return;
      }
      get().setEditViewZone(focusedPane === "tasks"
        ? "stories"
        : get().editViewZone === "stories" ? "active-tab-body" : get().editViewZone);
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
          engaged && isEngageableZone(state.editViewZone),
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

    // Retired compatibility actions never route a Modules pane or cursor.
    moveModulesCursor() {},
    setModulesCursor() {},

    toggleSidebar() {
      toggleModuleManager();
    },

    setSidebarVisible() {
      set({ sidebarVisible: false });
    },

    setPanelLayout(panelLayout) {
      const normalized = normalizePanelLayout(panelLayout);
      if (!normalized) return;
      persistPanelLayout(normalized);
      set({ panelLayout: normalized });
    },

  };
}
