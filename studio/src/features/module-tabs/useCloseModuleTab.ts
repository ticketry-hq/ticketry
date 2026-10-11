import { useCallback } from "react";
import { useClientStore } from "../../state/clientStore";
import { getModuleFolder } from "../module-links";
import { getModulesSnapshot, useStudioStore } from "../projects";
import { getStorySprintFilterGeneration } from "../work-items";
import { ROADMAP_ENABLED } from "../../shared/config/roadmapAvailability";
import { getEffectiveModuleTabsSnapshot } from "./effectiveModuleTabs";
import { useSetModuleTabHidden } from "./useSetModuleTabHidden";

/** Close changes presentation only; navigation remains scoped to the initiating filter. */
export function useCloseModuleTab() {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const setTabHidden = useSetModuleTabHidden();
  return useCallback(async (moduleId: string) => {
    if (!projectId || useStudioStore.getState().selectedProjectId !== projectId) return;
    const projection = getEffectiveModuleTabsSnapshot(projectId);
    if (!projection.modules.some(({ id }) => id === moduleId)) return;
    const filterGeneration = getStorySprintFilterGeneration(projectId);
    const selection = JSON.stringify(projection.selection);
    const scopeCurrent = () => useStudioStore.getState().selectedProjectId === projectId
      && getEffectiveModuleTabsSnapshot(projectId).projectGeneration === projection.projectGeneration
      && (!ROADMAP_ENABLED || (getStorySprintFilterGeneration(projectId) === filterGeneration
        && JSON.stringify(getEffectiveModuleTabsSnapshot(projectId).selection) === selection));
    const state = useClientStore.getState();
    const closingSelected = state.selectedModuleId === moduleId;
    const modules = getModulesSnapshot(projectId);
    const closedIndex = modules.findIndex(({ id }) => id === moduleId);
    const shownIds = new Set(projection.modules.map(({ id }) => id));
    const fallback = modules.slice(closedIndex + 1).find(({ id }) => shownIds.has(id) && getModuleFolder(id))
      ?? [...modules.slice(0, closedIndex)].reverse().find(({ id }) => shownIds.has(id) && getModuleFolder(id));
    const fallbackId = fallback?.id ?? null;
    if (closingSelected) {
      if (fallbackId) void state.selectModule(fallbackId, { isCurrent: () => scopeCurrent()
        && getEffectiveModuleTabsSnapshot(projectId).modules.some(({ id }) => id === fallbackId) });
      else state.deselectModule();
    }
    const saved = await setTabHidden(moduleId, true);
    if (!saved && closingSelected && scopeCurrent()
      && useClientStore.getState().selectedModuleId === fallbackId
      && getEffectiveModuleTabsSnapshot(projectId).modules.some(({ id }) => id === moduleId)) {
      await useClientStore.getState().selectModule(moduleId, { isCurrent: scopeCurrent });
    }
  }, [projectId, setTabHidden]);
}
