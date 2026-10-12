import { useCloseModuleTab, useModuleNavigation, getEffectiveModuleTabsSnapshot } from "../module-tabs";
import { archiveManagerModule } from "./archiveModule";
import { closeModuleManager, useModuleManagerStore } from "./state";

export type ModuleManagerAction = "open" | "close" | "restore" | "archive";
export function useManagerActions() {
  const navigation = useModuleNavigation();
  const closeTab = useCloseModuleTab();
  return async (moduleId: string, action: ModuleManagerAction): Promise<void> => {
    const started = useModuleManagerStore.getState();
    if (!started.active || !started.projectId || started.pendingActions[moduleId]) return;
    useModuleManagerStore.setState({ pendingActions: { ...started.pendingActions, [moduleId]: true },
      actionErrors: { ...started.actionErrors, [moduleId]: "" } });
    const current = () => { const state = useModuleManagerStore.getState();
      return state.active && state.generation === started.generation && state.projectId === started.projectId; };
    let succeeded = false;
    try {
      if (action === "archive") succeeded = await archiveManagerModule(started.projectId, moduleId, current);
      else if (action === "close") {
        await closeTab(moduleId);
        succeeded = getEffectiveModuleTabsSnapshot(started.projectId).entries.find(({ module }) => module.id === moduleId)?.status === "hidden";
      } else succeeded = await (action === "open" ? navigation.openModule(moduleId, { isCurrent: current, leaveSurfaces: true }) : navigation.restoreModule(moduleId, { isCurrent: current }));
      if (!current()) return;
      if (succeeded && action === "open") {
        useModuleManagerStore.setState((state) => ({ pendingActions: { ...state.pendingActions, [moduleId]: false } }));
        closeModuleManager({ restoreFocus: false });
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-pane="tasks"] [role="tree"], [data-pane="tasks"] input[aria-label="Search stories"], [data-workspace-tablist] [role="tab"][aria-selected="true"]')?.focus());
      } else if (!succeeded) useModuleManagerStore.setState((state) => ({ actionErrors: {
        ...state.actionErrors, [moduleId]: "Module action could not be completed. Retry when this module is available.",
      } }));
    } catch (error) {
      if (current()) useModuleManagerStore.setState((state) => ({ actionErrors: {
        ...state.actionErrors, [moduleId]: error instanceof Error ? error.message : "Module action failed.",
      } }));
    } finally {
      if (current()) useModuleManagerStore.setState((state) => ({ pendingActions: { ...state.pendingActions, [moduleId]: false } }));
    }
  };
}
