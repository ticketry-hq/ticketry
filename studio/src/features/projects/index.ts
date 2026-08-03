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
  useModulesQuery,
  useProjectsQuery,
} from "./queries";
export {
  fetchModuleActivity,
  registerModuleRecencyProvider,
  sortModulesByRecency,
} from "./utilities/moduleRecency";
export { resolveStartProject } from "./utilities/recentProjects";
