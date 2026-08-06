import type { Module, State, WorkItem } from "../../shared/api/types";
import { RESOLVED_GROUPS } from "../../shared/utilities/display";

/** Walk the loaded parent chain to the owning module. */
export function deriveEpic(
  task: WorkItem | null,
  modules: Module[],
  items: WorkItem[],
): Module | null {
  if (!task) return null;
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  let parentId = task.parent_id;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const module = moduleById.get(parentId);
    if (module) return module;
    const parent = itemById.get(parentId);
    if (!parent) return null;
    parentId = parent.parent_id;
  }
  return null;
}

export interface BlockerChip {
  id: string;
  key: string | null;
  name: string | null;
  state: State | null;
  unresolved: boolean;
}

/** Resolve dependency ids from the currently mounted per-item holdings. */
export function resolveBlockerChips(
  ids: string[],
  items: WorkItem[],
  modules: Module[],
): BlockerChip[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  return ids.map((id) => {
    const item = itemById.get(id);
    if (item) {
      return {
        id,
        key: item.key,
        name: item.name,
        state: item.state,
        unresolved: !RESOLVED_GROUPS.has(item.state?.group ?? ""),
      };
    }
    const module = moduleById.get(id);
    if (module) {
      return {
        id,
        key: module.key,
        name: module.name,
        state: null,
        unresolved: false,
      };
    }
    return { id, key: null, name: null, state: null, unresolved: false };
  });
}
