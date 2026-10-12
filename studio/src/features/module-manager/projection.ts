import type { ModuleTabEntry, ModuleTabStatus } from "../module-tabs";
import { editionHas } from "../../shared/config/edition";

/** Sprint exclusion only exists where sprint planning is compiled in. */
export const MODULE_MANAGER_GROUPS: readonly { id: ModuleTabStatus; title: string }[] = [
  { id: "open", title: "Open" }, { id: "hidden", title: "Hidden" },
  ...(editionHas("sprintPlanning") ? [{ id: "not-in-sprint" as const, title: "Not in sprint" }] : []),
  { id: "archived", title: "Archived" },
];
export interface ModuleManagerGroup {
  id: ModuleTabStatus;
  title: string;
  entries: ModuleTabEntry[];
  total: number;
  expanded: boolean;
}

/** Search changes inspection visibility, never the shared tab membership or saved collapse preferences. */
export function projectModuleManagerGroups(entries: readonly ModuleTabEntry[], search: string,
  folders: Readonly<Record<string, string>>, collapsed: Readonly<Record<string, boolean>>): ModuleManagerGroup[] {
  const query = search.trim().toLocaleLowerCase();
  return MODULE_MANAGER_GROUPS.map(({ id, title }) => {
    const all = entries.filter((entry) => entry.status === id);
    const matching = query ? all.filter(({ module }) => [module.name, module.key, folders[module.id] ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(query))) : all;
    return { id, title, total: all.length, entries: matching,
      expanded: query && matching.length > 0 ? true : !(collapsed[id] ?? id === "archived") };
  });
}
