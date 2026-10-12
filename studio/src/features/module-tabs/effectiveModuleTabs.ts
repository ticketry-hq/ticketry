import type { Module, ModulePresentation } from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { editionHas } from "../../shared/config/edition";
import { getModulesSnapshot, getProjectSelectionGeneration, useCachedModules, WorkTrackerProjectOpenDocument } from "../projects";
import { getStorySprintReadsSnapshot, useActiveStorySprint, useSelectedStorySprint } from "../sprints";
import { getProjectStorySprintIndexSnapshot, getStorySprintFilterIntent, getStorySprintFilterGeneration,
  useStorySprintFilterGeneration, resolveStorySprintFilter, useProjectStorySprintIndex,
  useStorySprintFilterIntent } from "../work-items";
import { getModulePresentationsSnapshot, useModulePresentations } from "./modulePresentation";
import { projectModuleTabs, type EffectiveModuleTabs } from "./moduleTabProjection";
export type { EffectiveModuleTabs } from "./moduleTabProjection";

function normalTabs(projectId: string | null, modules: readonly Module[],
  presentations: readonly ModulePresentation[] | undefined, complete: boolean): EffectiveModuleTabs {
  return projectModuleTabs({ projectId, projectGeneration: getProjectSelectionGeneration(),
    modules, presentations, modulesComplete: complete,
    selection: { mode: "all" }, index: { roots: [], complete: true }, filterGeneration: 0 });
}

export function getEffectiveModuleTabsSnapshot(projectId: string | null): EffectiveModuleTabs {
  const modulesComplete = !!projectId && !!studioApolloClient().readQuery({ query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) }, optimistic: true });
  if (!editionHas("sprintPlanning")) return normalTabs(projectId, getModulesSnapshot(projectId),
    getModulePresentationsSnapshot(projectId), modulesComplete);
  const intent = getStorySprintFilterIntent(projectId);
  const reads = getStorySprintReadsSnapshot(projectId, intent.mode === "id" ? intent.sprintId : null);
  const resolution = resolveStorySprintFilter(intent, reads.active, reads.selected);
  return projectModuleTabs({ projectId, projectGeneration: getProjectSelectionGeneration(), modules: getModulesSnapshot(projectId),
    presentations: getModulePresentationsSnapshot(projectId), modulesComplete,
    selection: intent.mode === "id" ? { mode: "id", sprintId: intent.sprintId } : resolution.selection,
    index: getProjectStorySprintIndexSnapshot(projectId), filterGeneration: getStorySprintFilterGeneration(projectId) });
}

/** Cache-only observers work outside the filter context and never own a network lifetime. */
export function useEffectiveModuleTabs(projectId: string | null, modules?: readonly Module[],
  presentations?: readonly ModulePresentation[]): EffectiveModuleTabs {
  const cachedModules = useCachedModules(projectId);
  const cachedPresentations = useModulePresentations(projectId);
  const sprintProjectId = editionHas("sprintPlanning") ? projectId : null;
  const intent = useStorySprintFilterIntent(sprintProjectId);
  const generation = useStorySprintFilterGeneration(sprintProjectId);
  const active = useActiveStorySprint(sprintProjectId, "cache-only");
  const selected = useSelectedStorySprint(sprintProjectId, intent.mode === "id" ? intent.sprintId : null, "cache-only");
  const index = useProjectStorySprintIndex(sprintProjectId, "cache-only");
  if (!editionHas("sprintPlanning")) return normalTabs(projectId, modules ?? cachedModules,
    presentations ?? cachedPresentations, presentations !== undefined || cachedPresentations !== undefined);
  const resolution = resolveStorySprintFilter(intent, active, selected);
  return projectModuleTabs({ projectId, projectGeneration: getProjectSelectionGeneration(), modules: modules ?? cachedModules,
    presentations: presentations ?? cachedPresentations,
    modulesComplete: presentations !== undefined || cachedPresentations !== undefined,
    selection: intent.mode === "id" ? { mode: "id", sprintId: intent.sprintId } : resolution.selection,
    index, filterGeneration: generation });
}

export function getVisibleModulesSnapshot(projectId: string | null): Module[] {
  return getEffectiveModuleTabsSnapshot(projectId).modules;
}
