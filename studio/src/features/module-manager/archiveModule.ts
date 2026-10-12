import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { editionHas } from "../../shared/config/edition";
import { studioApolloClient } from "../../shared/apollo/client";
import { dialog, useClientStore } from "../../state/clientStore";
import { getModuleFolder } from "../module-links";
import { getEffectiveModuleTabsSnapshot } from "../module-tabs";
import { getModulesSnapshot } from "../projects";
import { ArchiveWorkTrackerWorkItemDocument } from "../work-items";
import { adoptArchivedModule, refreshArchivedModule } from "./convergeArchivedModule";
import { useModuleManagerStore } from "./state";

/** Archive is a restricted record update; the server owns the entire subtree cascade. */
export async function archiveManagerModule(projectId: string, moduleId: string, isCurrent: () => boolean): Promise<boolean> {
  const modules = getModulesSnapshot(projectId);
  const module = modules.find((entry) => entry.id === moduleId);
  if (!module || module.is_archived || !isCurrent()) return false;
  const projection = getEffectiveModuleTabsSnapshot(projectId);
  const confirmed = await dialog.confirm({ title: `Archive ${module.name}?`,
    body: `Archiving “${module.name}” archives all descendant Stories and work items on the server. They leave active lists${editionHas("sprintPlanning") ? " and sprint membership" : ""}. The module remains available for inspection in Archived.`,
    confirmLabel: "Archive module", danger: true });
  if (!confirmed) return true;
  if (!isCurrent()) return true;
  const filterGeneration = projection.filterGeneration;
  const projectGeneration = projection.projectGeneration;
  const navigationCurrent = () => isCurrent()
    && getEffectiveModuleTabsSnapshot(projectId).filterGeneration === filterGeneration
    && getEffectiveModuleTabsSnapshot(projectId).projectGeneration === projectGeneration;
  const wasSelected = useClientStore.getState().selectedModuleId === moduleId;
  const client = studioApolloClient();
  const result = await client.mutate({ mutation: ArchiveWorkTrackerWorkItemDocument,
    variables: { id: compactWorktrackerId(moduleId), isArchived: true } });
  if (!result.data?.update_work_item.is_archived) throw new Error("Module archive was refused. Retry the archive.");
  adoptArchivedModule(projectId, result.data.update_work_item);
  if (isCurrent() && useModuleManagerStore.getState().renameEdit?.moduleId === moduleId) useModuleManagerStore.setState({ renameEdit: null });
  if (wasSelected && navigationCurrent() && useClientStore.getState().selectedModuleId === moduleId) {
    const eligible = new Set(getEffectiveModuleTabsSnapshot(projectId).modules.map(({ id }) => id));
    const index = modules.findIndex(({ id }) => id === moduleId);
    const fallback = modules.slice(index + 1).find(({ id }) => eligible.has(id) && getModuleFolder(id))
      ?? [...modules.slice(0, index)].reverse().find(({ id }) => eligible.has(id) && getModuleFolder(id));
    if (fallback) await useClientStore.getState().selectModule(fallback.id, { isCurrent: navigationCurrent });
    else useClientStore.getState().deselectModule();
  }
  if (isCurrent() && useModuleManagerStore.getState().selectedModuleId === moduleId) {
    useModuleManagerStore.setState({ selectedModuleId: null, detailOpen: false });
  }
  await refreshArchivedModule(projectId, moduleId);
  return true;
}
