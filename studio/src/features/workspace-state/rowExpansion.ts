import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
import { readCollapsedStateStorage, finishCollapsedStateMigration, writeCollapsedStateIds, writeExpandedIdsByModule } from "../../state/persistence";
const collapsedStorage = readCollapsedStateStorage();
let pendingCollapsedStateNames = collapsedStorage.legacyNames;
export const initialCollapsedStateIds = collapsedStorage.ids;
function nextExpandedMap(
  current: Readonly<Record<string, string[]>>,
  moduleId: string,
  update: (ids: Set<string>) => void,
): Record<string, string[]> {
  const ids = new Set(current[moduleId] ?? []);
  update(ids);
  return { ...current, [moduleId]: [...ids] };
}



export function rowExpansionActions(set: SetWorkspaceState, _get: GetWorkspaceState): Pick<ClientState,
  | "toggleExpanded"
  | "setExpanded"
  | "expandMany"
  | "toggleStateCollapsed"
  | "migrateCollapsedStateNames"
> {
  return {
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

  };
}
