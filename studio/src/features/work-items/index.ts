// Retained work-item state and workspace interfaces. The retired backlog view
// and its composition are intentionally absent from this public surface.
export { useWorkItems } from "./hooks";
export { useBacklogStore, matchesQuery, groupBacklog } from "./internal/backlogStore";
export type { EpicGroup, TreeNode } from "./internal/backlogStore";
export { usePlanningFilterStore } from "./internal/planningFilterStore";
export { useSelectionStore } from "./stores/selectionStore";
export type { SelectionSurface } from "./stores/selectionStore";
export { rankBetween } from "./utilities/rank";
// The issue-detail UI (IssueDetail, IssueWorkspace, WorkspacePane, …) is
// deliberately NOT re-exported here: every current consumer of this hub
// imports stores only, and a UI re-export would drag the whole issue-detail
// component graph into their dev module graphs (bundle-barrel-imports).
// UI consumers import from ./issue-detail, which is its own public entrypoint.
export {
  DEFAULT_WORKSPACE,
  useIssueDrawerWorkspaceStore,
} from "./issue-detail/internal/drawerWorkspaceStore";
