// Retained work-item state and workspace interfaces. The retired backlog view
// and its composition are intentionally absent from this public surface.
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
export {
  createWorkItem,
  deleteWorkItem,
  reorderWorkItem,
} from "./mutationTransport";
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
  EMPTY_MODULE_TREE,
  getModuleTreeSnapshot,
  getWorkItemSnapshot,
  loadModuleTree,
  readWorkItem,
  readProjectWorkItems,
  useWorkItem,
  useWorkItemAttachments,
  useModuleOpen,
  useModuleItems,
  useModuleTree,
} from "./queries";
export { StoriesTreeProvider, useStoriesTree } from "./queries/StoriesTreeProvider";
export { getModuleTaskOrderSnapshot } from "./queries/moduleTaskOrderSnapshot";
export { useReviewFindingChildren } from "./queries/useReviewFindingChildren";
export {
  deriveEpic,
  orderedTaskSections,
  orderIdsByRank,
  resolveBlockerChips,
  searchHits,
  selectModuleTaskOrder,
  taskRevealPath,
  visibleRows,
  isPlanningRow,
  LOADING_PLACEHOLDER,
  STATE_HEADER,
  CONVERSATIONS_SECTION_ID,
} from "./selectors";
export type {
  BlockerChip,
  OrderedTaskSection,
  TaskRevealPath,
  TreeWorkItem,
  WorkItemRow,
  PlanningRow,
  PlanningTreeRow,
  InstantRunRow,
  ScratchRow,
} from "./selectors";
export { formatWorkItemDisplayIdentifier } from "./displayIdentifier";
export { recordStoryMove } from "./internal/storyMoveDiagnostics";
export { usePlanningFilterStore } from "./internal/planningFilterStore";
export {
  clearStorySprintFilter,
  getStorySprintFilterIntent,
  getStorySprintFilterGeneration,
  useStorySprintFilterGeneration,
  setStorySprintFilterIntent,
  useStorySprintFilterIntent,
  setStorySprintFilterNotice,
  useStorySprintFilterNotice,
} from "./internal/storySprintFilterStore";
export type { StorySprintIntent } from "./internal/storySprintFilterStore";
export { resolveStorySprintFilter, filterStoryRoots, selectStorySprintResults, projectRootSprintCounts } from "./selectors/storySprintFilter";
export type { StorySprintSelection, StorySprintResolution } from "./selectors/storySprintFilter";
export { useClientStore } from "../../state/clientStore";
export type { SelectionSurface } from "../../state/clientStore";
export { rankBetween } from "./utilities/rank";
export { reachable } from "./utilities/dependencyGraph";
export type { DependencyEdgeField } from "./utilities/dependencyGraph";
export {
  ArchiveWorkTrackerWorkItemDocument,
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  UpdateWorkTrackerWorkspaceTabOrderDocument,
  WorkTrackerModuleOpenDocument,
  WorkTrackerReviewFindingsDocument,
  WorkTrackerWorkItemDocument,
  WorkTrackerWorkItemsDocument,
} from "./generated/workItems.documents";
export type {
  GeneratedWorkTrackerWorkItemFieldsFragment,
  WorkTrackerModuleOpenQuery,
  WorkTrackerModuleOpenQueryVariables,
  WorkTrackerWorkItemQuery,
  WorkTrackerWorkItemQueryVariables,
  WorkTrackerWorkItemsQuery,
  WorkTrackerWorkItemsQueryVariables,
} from "./generated/workItems.documents";
export {
  registerNormalRunCommand,
  runWorkItem,
  startNormalRun,
  startNormalRunForSelectedItem,
} from "./normalRun";
export type { NormalRunResult } from "./normalRun";
export {
  isRunNowEligible,
  startRunNow,
  startRunNowForSelectedItem,
  useRunNowPending,
  useRunNowTransitions,
} from "./runNow";
export { default as WorkItemSearchList } from "./WorkItemSearchList";
export { FindingLocationLabel } from "./FindingLocationLabel";
export {
  formatFindingLocation,
  parseFindingLocation,
  type FindingLocation,
} from "./findingLocation";
export { watchNewTaskRunTab, type NewTaskRunTabWatch } from "./taskRunTabActivation";
export { consumeLocalWorkItemConvergence } from "./workItemConvergence";
export { usePlanWorkItem } from "./planMutation";
export { usePlanWritePending } from "./planWriteGuard";

export { useStoryReorderController, stateDropTargetId } from "./useStoryReorderController";
export type { TicketDragPayload } from "./useStoryReorderController";
export { resolveTicketReorderNeighbors } from "./internal/ticketReorder";
export type { VisibleRootBlock, ReorderNeighbors } from "./internal/ticketReorder";

export { StorySprintFilterController, useStorySprintFilter } from "./filter/StorySprintFilterController";
export { StorySprintFilter } from "./filter/StorySprintFilter";
export { StoriesFilterEmptyState } from "./filter/StoriesFilterEmptyState";
export { SelectedStoryFilterNotice } from "./filter/SelectedStoryFilterNotice";
export { useProjectStorySprintIndex, getProjectStorySprintIndexSnapshot } from "./queries/useProjectStorySprintIndex";

export { SprintModuleRecovery } from "./filter/SprintModuleRecovery";
export { CapturedIdeaRecovery } from "./filter/CapturedIdeaRecovery";
export { capturedStoryOutsideResults, prepareExplicitStoryReveal } from "./filter/storySprintRecovery";
export { refreshProjectStorySprintIndex } from "./queries/refreshProjectStorySprintIndex";

export { useStoryCreation, type CreateOutcome, type AssignOutcome, type RefreshOutcome } from "./storyCreation";

export { PlanningRowView } from "./components/PlanningRowView";
export type { PlanningRowViewProps } from "./components/PlanningRowView";
export { WorkItemRowLabel } from "./components/WorkItemRowLabel";
export { orderedWorkItems } from "./issueAdapter";
