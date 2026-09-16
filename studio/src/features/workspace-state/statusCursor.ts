import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
export function statusCursorActions(set: SetWorkspaceState, _get: GetWorkspaceState): Pick<ClientState,
  | "advanceWorkItemCursor"
> {
  return {
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
  };
}
