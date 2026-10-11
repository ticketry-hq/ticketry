import type { Module, ModulePresentation } from "../../shared/api/types";
import { publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import type { StorySprintSelection } from "../work-items";
import { hiddenModuleIds } from "./modulePresentation";

type RootMembership = {
  project_id: string; parent_id: string | null; module_id: string | null;
  sprint_id: string | null; is_archived: boolean;
};
export type ModuleTabStatus = "archived" | "hidden" | "not-in-sprint" | "open";
export interface ModuleTabEntry {
  module: Module;
  status: ModuleTabStatus;
  /** Unknown during incomplete membership reads; presentation status remains usable. */
  sprintEligible: boolean | null;
}
export interface EffectiveModuleTabs {
  modules: Module[];
  entries: ModuleTabEntry[];
  projectId: string | null;
  projectGeneration: number;
  filterGeneration: number;
  restricted: boolean;
  complete: boolean;
  loading: boolean;
  noMatches: boolean;
  selection: StorySprintSelection | null;
  generation: string;
}
export interface ModuleTabProjectionInput {
  projectId: string | null;
  projectGeneration?: number;
  modules: readonly Module[];
  presentations: readonly ModulePresentation[] | undefined;
  modulesComplete: boolean;
  selection: StorySprintSelection | null;
  index: { roots: readonly RootMembership[]; complete: boolean };
  filterGeneration: number;
}

/** Tabs and management share membership, presentation precedence and canonical input order. */
export function projectModuleTabs(input: ModuleTabProjectionInput): EffectiveModuleTabs {
  const { projectId, modules, presentations, selection, index, filterGeneration } = input;
  const projectGeneration = input.projectGeneration ?? 0;
  const restricted = selection !== null && selection.mode !== "all";
  const complete = !!selection && input.modulesComplete && presentations !== undefined && (!restricted || index.complete);
  const eligible = new Set(index.roots.filter((root) =>
    !root.is_archived && root.project_id === projectId && root.module_id && root.parent_id === root.module_id
    && (selection?.mode === "none" ? root.sprint_id === null
      : selection?.mode === "id" && root.sprint_id !== null
        && publicWorktrackerId(root.sprint_id) === publicWorktrackerId(selection.sprintId)))
    .map((root) => root.module_id));
  const hidden = hiddenModuleIds(presentations);
  const entries: ModuleTabEntry[] = modules.filter((module) => module.project_id === projectId).map((module) => {
    const sprintEligible = selection?.mode === "all" ? true : complete ? eligible.has(module.id) : null;
    const status: ModuleTabStatus = module.is_archived ? "archived" : hidden.has(module.id) ? "hidden"
      : sprintEligible === false ? "not-in-sprint" : "open";
    return { module, status, sprintEligible };
  });
  const shown = entries.filter(({ status }) => status === "open").map(({ module }) => module);
  return { modules: shown, entries, projectId, projectGeneration, filterGeneration, restricted, complete, loading: !complete,
    noMatches: restricted && complete && shown.length === 0, selection,
    generation: JSON.stringify([projectId, projectGeneration, filterGeneration, selection, shown.map(({ id }) => id)]) };
}
