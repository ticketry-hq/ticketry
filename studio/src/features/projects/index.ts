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
  readOnboardingProjects,
  readProjectOpen,
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
export {
  reorderModulePresentation,
  setModuleTabHidden,
} from "./modulePresentationTransport";
export { moduleDragCodec } from "./internal/moduleDrag";
export type { ModuleDragPayload } from "./internal/moduleDrag";
export { useModuleReorderDrag } from "./internal/moduleReorderDrag";
export type { ModuleReorderDrag } from "./internal/moduleReorderDrag";
export { planModuleReorder } from "./internal/moduleReorder";
export type { ModuleReorderPlan } from "./internal/moduleReorder";
export {
  WorkTrackerProjectIssueTypesDocument,
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectStatesDocument,
  WorkTrackerOnboardingDocument,
  WorkTrackerProjectsDocument,
} from "./generated/projects.documents";
export type {
  WorkTrackerProjectOpenQuery,
  WorkTrackerProjectsQuery,
  WorkTrackerProjectsQueryVariables as WorkTrackerProjectsVariables,
  WorkTrackerOnboardingQuery,
  WorkTrackerOnboardingQueryVariables as WorkTrackerOnboardingVariables,
} from "./generated/projects.documents";
export type { OnboardingProject } from "../../shared/api/types";
