import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
export function taskSelectionActions(set: SetWorkspaceState, get: GetWorkspaceState): Pick<ClientState,
  | "selectionToggle"
  | "selectionRange"
  | "selectionReplace"
  | "selectionClear"
  | "setStorySearchQuery"
> {
  return {
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

  };
}
