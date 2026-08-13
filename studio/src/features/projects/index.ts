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
} from "./utilities/canonicalModuleOrder";
export {
  fetchModuleActivity,
  registerModuleRecencyProvider,
  sortModulesByRecency,
} from "./utilities/moduleRecency";
export { resolveStartProject } from "./utilities/recentProjects";
export {
  WorkTrackerModulesDocument,
  WorkTrackerProjectsDocument,
  WorkTrackerWorkspaceDocument,
} from "./generated/operations";
export type {
  WorkTrackerModule,
  WorkTrackerModulesQuery,
  WorkTrackerModulesVariables,
  WorkTrackerProject,
  WorkTrackerProjectsQuery,
  WorkTrackerProjectsVariables,
  WorkTrackerWorkspace,
  WorkTrackerWorkspaceQuery,
  WorkTrackerWorkspaceVariables,
} from "./generated/operations";
