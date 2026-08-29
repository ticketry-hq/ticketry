// Retained project state and ordering interfaces. The retired project views
// and switcher are intentionally absent from this public surface.
export { normalizeView, useStudioStore } from "./store";
export type { DeleteProjectResult } from "./store";
export {
  createProjectRecord,
  deleteProjectRecord,
  getModulesSnapshot,
  getProjectsSnapshot,
  loadModules,
  loadProjects,
  readProjectOpen,
  readWorkspace,
  seedModules,
  seedProjects,
  useCachedModules,
  useCachedProjects,
  useModulesQuery,
  useProjectsQuery,
  updateProjectRecord,
} from "./queries";
export { acknowledgeOnboarding } from "./mutationTransport";
export {
  getStatesSnapshot,
  loadStates,
  reloadStates,
  removeState,
  seedStates,
  setStates,
  setStatesSorted,
  stateById,
  upsertState,
  useCachedStates,
} from "./stateCatalog";
export { useReorderModule } from "./mutations";
export type { ModuleReorderControls } from "./mutations";
export { moduleDragCodec } from "./internal/moduleDrag";
export type { ModuleDragPayload } from "./internal/moduleDrag";
export { useModuleReorderDrag } from "./internal/moduleReorderDrag";
export type { ModuleReorderDrag } from "./internal/moduleReorderDrag";
export { resetAcceptedManualModuleOrder } from "./internal/acceptedManualModuleOrder";
export { resetNewlyCreatedModules } from "./internal/newlyCreatedModules";
export { planModuleReorder } from "./internal/moduleReorder";
export type { ModuleReorderPlan } from "./internal/moduleReorder";
export {
  applyCanonicalModuleOrder,
  usesManualModuleOrder,
} from "./selectors";
export {
  fetchModuleActivity,
  registerModuleRecencyProvider,
  sortModulesByRecency,
} from "./utilities/moduleRecency";
export {
  WorkTrackerProjectIssueTypesDocument,
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectStatesDocument,
  WorkTrackerProjectsDocument,
  WorkTrackerWorkspaceDocument,
} from "./generated/projects.documents";
export type {
  WorkTrackerProjectOpenQuery,
  WorkTrackerProjectsQuery,
  WorkTrackerProjectsQueryVariables as WorkTrackerProjectsVariables,
  WorkTrackerWorkspaceQuery,
  WorkTrackerWorkspaceQueryVariables as WorkTrackerWorkspaceVariables,
} from "./generated/projects.documents";
