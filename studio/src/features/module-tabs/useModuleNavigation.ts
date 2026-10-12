import { useCallback } from "react";
import { useStudioStore } from "../projects";
import { clearStorySprintFilter } from "../work-items";
import { useClientStore } from "../../state/clientStore";
import { getEffectiveModuleTabsSnapshot } from "./effectiveModuleTabs";
import { leaveWorkspaceSurfaces } from "./leaveWorkspaceSurfaces";
import { useSetModuleTabHidden } from "./useSetModuleTabHidden";

/** Explicit presentation actions; inspection and ordinary selection use no writes. */
interface ModuleNavigationOptions {
  isCurrent?: () => boolean;
  /** Exit Plan and Changes once every guard passes, immediately before selecting. */
  leaveSurfaces?: boolean;
}
export function useModuleNavigation() {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const selectModule = useClientStore((state) => state.selectModule);
  const setTabHidden = useSetModuleTabHidden();

  const navigate = useCallback(async (moduleId: string, restore: boolean, select: boolean, options?: ModuleNavigationOptions): Promise<boolean> => {
    if (!projectId || useStudioStore.getState().selectedProjectId !== projectId || options?.isCurrent?.() === false) return false;
    let projection = getEffectiveModuleTabsSnapshot(projectId);
    const entry = projection.entries.find(({ module }) => module.id === moduleId);
    if (!entry || entry.status === "archived" || (!restore && entry.status === "hidden")) return false;
    if (projection.loading) return false;
    if (projection.restricted && entry.sprintEligible === false) {
      clearStorySprintFilter(projectId);
      projection = getEffectiveModuleTabsSnapshot(projectId);
    }
    const filterGeneration = projection.filterGeneration;
    const projectGeneration = projection.projectGeneration;
    const isCurrent = () => {
      if (options?.isCurrent?.() === false) return false;
      if (useStudioStore.getState().selectedProjectId !== projectId) return false;
      const current = getEffectiveModuleTabsSnapshot(projectId);
      const currentEntry = current.entries.find(({ module }) => module.id === moduleId);
      return current.complete && current.projectGeneration === projectGeneration
        && current.filterGeneration === filterGeneration && !!currentEntry
        && currentEntry.status !== "archived" && currentEntry.sprintEligible === true
        && (!select || currentEntry.status === "open");
    };
    if (restore && entry.status === "hidden") {
      if (!await setTabHidden(moduleId, false) || !isCurrent()) return false;
    }
    if (!isCurrent()) return false;
    if (select) {
      if (getEffectiveModuleTabsSnapshot(projectId).entries.find(({ module }) => module.id === moduleId)?.status !== "open") return false;
      if (options?.leaveSurfaces) leaveWorkspaceSurfaces();
      await selectModule(moduleId, { isCurrent });
      return isCurrent() && useClientStore.getState().selectedModuleId === moduleId;
    }
    return true;
  }, [projectId, selectModule, setTabHidden]);

  const openModule = useCallback((moduleId: string, options?: ModuleNavigationOptions) => navigate(moduleId, false, true, options), [navigate]);
  const restoreModule = useCallback((moduleId: string, options?: ModuleNavigationOptions) => navigate(moduleId, true, false, options), [navigate]);
  const restoreAndSelectModule = useCallback((moduleId: string) => navigate(moduleId, true, true), [navigate]);
  return { openModule, restoreModule, restoreAndSelectModule };
}
