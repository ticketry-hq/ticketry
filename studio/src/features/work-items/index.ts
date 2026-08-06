// Retained work-item state and workspace interfaces. The retired backlog view
// and its composition are intentionally absent from this public surface.
export { useWorkItems } from "./hooks";
export {
  useChangeWorkItemType,
  useCreateWorkItem,
  useEditWorkItemDescription,
  useRenameWorkItem,
  useReorderWorkItem,
  useSetWorkItemBlockers,
  useSetWorkItemParent,
  useSetWorkItemState,
} from "./mutations";
export type {
  ChangeWorkItemTypeArgs,
  EditWorkItemDescriptionArgs,
  ModuleMembership,
  RenameWorkItemArgs,
  ReorderWorkItemArgs,
  SetWorkItemBlockersArgs,
  SetWorkItemParentArgs,
  SetWorkItemStateArgs,
} from "./mutations";
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
  useWorkItem,
  useWorkItemsByIds,
} from "./queries";
export {
  deriveEpic,
  resolveBlockerChips,
} from "./selectors";
export type { BlockerChip } from "./selectors";
export { useBacklogStore, matchesQuery, groupBacklog } from "./internal/backlogStore";
export type { EpicGroup, TreeNode } from "./internal/backlogStore";
export { usePlanningFilterStore } from "./internal/planningFilterStore";
export { useClientStore } from "../../state/clientStore";
export type { SelectionSurface } from "../../state/clientStore";
export { rankBetween } from "./utilities/rank";
export { reachable } from "./utilities/dependencyGraph";
export type { DependencyEdgeField } from "./utilities/dependencyGraph";
