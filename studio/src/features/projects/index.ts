// Retained project state and ordering interfaces. The retired project views
// and switcher are intentionally absent from this public surface.
export { normalizeView, useStudioStore } from "./store";
export type { DeleteProjectResult, ProjectResourceStatus } from "./store";
export {
  fetchModuleActivity,
  registerModuleRecencyProvider,
  sortModulesByRecency,
} from "./utilities/moduleRecency";
export { resolveStartProject } from "./utilities/recentProjects";
