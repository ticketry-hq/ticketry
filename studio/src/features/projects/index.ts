// Retained project state and ordering interfaces. The retired project views
// and switcher are intentionally absent from this public surface.
export { normalizeView, useStudioStore } from "./store";
export type { DeleteProjectResult } from "./store";
export {
  getModulesSnapshot,
  getProjectsSnapshot,
  loadModules,
  loadProjects,
  seedModules,
  seedProjects,
  useCachedModules,
  useCachedProjects,
  useModulesQuery,
  useProjectsQuery,
} from "./queries";
export { useReorderModule } from "./mutations";
export type { ModuleReorderControls } from "./mutations";
export { moduleDragCodec } from "./internal/moduleDrag";
export type { ModuleDragPayload } from "./internal/moduleDrag";
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
