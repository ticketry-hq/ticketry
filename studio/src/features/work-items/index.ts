// Retained work-item state and workspace interfaces. The retired backlog view
// and its composition are intentionally absent from this public surface.
export { useWorkItems } from "./hooks";
export {
  getWorkItemDetailSnapshot,
  getWorkItemIndexSnapshot,
  getChildWorkItemsSnapshot,
  getProjectWorkItemsSnapshot,
  loadChildWorkItems,
  loadProjectWorkItems,
  loadWorkItemDetail,
  setChildWorkItems,
  setWorkItemDetail,
  setWorkItemIndex,
  setProjectWorkItems,
} from "./queries";
export { useBacklogStore, matchesQuery, groupBacklog } from "./internal/backlogStore";
export type { EpicGroup, TreeNode } from "./internal/backlogStore";
export { usePlanningFilterStore } from "./internal/planningFilterStore";
export { useSelectionStore } from "./stores/selectionStore";
export type { SelectionSurface } from "./stores/selectionStore";
export { rankBetween } from "./utilities/rank";
export { reachable } from "./utilities/dependencyGraph";
export type { DependencyEdgeField } from "./utilities/dependencyGraph";
