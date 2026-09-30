import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
import { focusTerminal } from "../agents/terminal";
import type { TicketWorkspaceViewState } from "./types";
export const DEFAULT_WORKSPACE: TicketWorkspaceViewState = {
  active: "details",
  activeDocId: null,
  closedDocIds: [],
};



export function workspaceTabActions(set: SetWorkspaceState, get: GetWorkspaceState): Pick<ClientState,
  | "resetWorkspaces"
  | "ensureWorkspace"
  | "setActive"
  | "setActiveDoc"
  | "openDoc"
  | "closeDoc"
  | "reopenDoc"
  | "tabOpened"
  | "tabRekeyed"
  | "tabSelected"
  | "tabFocused"
> {
  return {
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

  };
}
