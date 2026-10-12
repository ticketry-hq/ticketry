import { useCallback, useMemo } from "react";
import { useClientStore } from "../../../../state/clientStore";
import { useStudioStore } from "../../../../features/projects";
import { useCachedStates } from "../../../../features/projects";
import {
  type PlanningRow as Row,
  StoriesTreeProvider,
  useStoriesTree,
  useStoryReorderController,
  StorySprintFilter,
  StoriesFilterEmptyState,
} from "../../../../features/work-items";
import { TEMP_TASK_ID } from "../../../../features/agents/types";
import { PaneShell } from "../../PaneShell";
import { TaskRow } from "./components/TaskRow";
import { StateHeaderRow } from "./components/StateHeaderRow";
import { ConversationsHeaderRow } from "./components/ConversationsHeaderRow";
import { LoadingPlaceholderRow } from "./components/LoadingPlaceholderRow";
import { IdeaEntry } from "./components/IdeaEntry";
import { NoWorkflowNotice } from "./components/NoWorkflowNotice";
import {
  NO_WORKFLOW_MESSAGE,
  useProjectWorkflowPresence,
} from "../../../../features/workflows";
import { StoriesSearchInput } from "./components/StoriesSearchInput";
import { StoryTreeList } from "../../../../features/stories/StoryTreeList";
import { groupRootBlocks } from "../../../../features/stories/storyRootBlocks";
import {
  instantRunPlanningRowId,
  selectPlanningRowId,
  useSelectedPlanningRowId,
} from "./internal/instantRunTicketNavigation";
import { startInstantChangeFlow } from "../../../../features/studio/modals/PlanFeature";
import {
  ConversationDesignPrototype,
  hasConversationDesignPrototype,
} from "../../../../features/conversations/prototype/ConversationDesignPrototype";

export {
  isPlanningRow,
  type PlanningRow as Row,
  type PlanningTreeRow as TreeRow,
  type InstantRunRow,
  type ScratchRow,
  type WorkItemRow,
} from "../../../../features/work-items";
import { recordSelectionProfilePoint } from "../../../../shared/utilities/selectionProfile";
import { selectedRunSession } from "../../../../features/agents/actions/agentRunActions";
import { useTerminalStore } from "../../../../features/agents/terminal/appNavigation";

export function planningRowId(row: Row): string {
  if (row.kind === "work-item") return row.id;
  if (row.kind === "instant-run") return instantRunPlanningRowId(row.runId);
  return TEMP_TASK_ID;
}

export function TasksPane() {
  return <StoriesTreeProvider><TasksPaneContent /></StoriesTreeProvider>;
}

function TasksPaneContent() {
  recordSelectionProfilePoint("tasks-pane-render");
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedRowId = useSelectedPlanningRowId();
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const states = useCachedStates(selectedProjectId);
  const workflowMissing =
    useProjectWorkflowPresence(selectedProjectId) === "missing";
  const toggleExpanded = useClientStore((s) => s.toggleExpanded);
  const collapsedStateIds = useClientStore((s) => s.collapsedStateIds);
  const toggleStateCollapsed = useClientStore((s) => s.toggleStateCollapsed);
  const toggleStateConfiguration = useClientStore(
    (s) => s.toggleStateConfiguration,
  );

  const {
    rows,
    itemsById,
    sectionIdsByState,
    loadingTasks,
    isSearchActive,
    sprintFilter,
    matchingRootCount,
    totalRootCount,
  } = useStoriesTree();
  const noStoryMatches = (isSearchActive || sprintFilter.restricted) &&
    sprintFilter.status === "ready" && !loadingTasks && matchingRootCount === 0;
  const renderBlocks = useMemo(() => groupRootBlocks(rows), [rows]);
  const visibleBlocks = useMemo(
    () =>
      renderBlocks.flatMap((block) =>
        block.kind === "block"
          ? [{
              rootId: planningRowId(block.rows[0]),
              rowIds: block.rows.map(planningRowId),
            }]
          : [],
      ),
    [renderBlocks],
  );

  const { dragDrop, reorder } = useStoryReorderController({
    projectId: selectedProjectId,
    moduleId: selectedModuleId,
    itemsById,
    states,
    sectionIdsByState,
    visibleBlocks,
    disabled: isSearchActive || sprintFilter.restricted || sprintFilter.status !== "ready",
  });

  // Stable, id-taking handlers so memoized rows don't re-render when the
  // pane does (e.g. on selection change).
  const handleSelect = useCallback((taskId: string) => {
    if (taskId === TEMP_TASK_ID) {
      startInstantChangeFlow();
      return;
    }
    selectPlanningRowId(taskId);
  }, []);
  const handleToggleExpand = useCallback(
    (taskId: string) => {
      if (!isSearchActive && selectedModuleId) {
        toggleExpanded(selectedModuleId, taskId);
      }
    },
    [isSearchActive, selectedModuleId, toggleExpanded],
  );
  const handleToggleStateCollapsed = useCallback(
    (stateId: string) => {
      if (!isSearchActive) toggleStateCollapsed(stateId);
    },
    [isSearchActive, toggleStateCollapsed],
  );
  const handleToggleStateConfiguration = useCallback(
    (stateId: string) => {
      if (selectedProjectId) {
        toggleStateConfiguration(selectedProjectId, stateId);
      }
    },
    [selectedProjectId, toggleStateConfiguration],
  );
  const handleToggleConversationConfiguration = useCallback(() => {
    if (selectedProjectId && selectedModuleId) {
      const closing = useClientStore.getState().workspaceSelection.kind ===
        "conversation-configuration";
      useClientStore.getState().toggleConversationConfiguration(
        selectedProjectId,
        selectedModuleId,
      );
      if (closing) {
        requestAnimationFrame(() => {
          const session = selectedRunSession();
          if (session) useTerminalStore.getState().focusSession(session.sessionId);
        });
      }
    }
  }, [selectedModuleId, selectedProjectId]);

  return (
    <PaneShell pane="tasks">
      <StoriesSearchInput />
      <StorySprintFilter matchingRootCount={matchingRootCount} totalRootCount={totalRootCount} storiesLoading={loadingTasks} />
      <IdeaEntry unavailableReason={workflowMissing ? NO_WORKFLOW_MESSAGE : null} />
      {workflowMissing ? (
        <NoWorkflowNotice />
      ) : noStoryMatches ? (
        <StoriesFilterEmptyState />
      ) : null}
      {hasConversationDesignPrototype() ? (
        <ConversationDesignPrototype />
      ) : rows.length === 0 && workflowMissing ? null : loadingTasks && rows.length === 0 ? (
        <div className="text-text-muted">…</div>
      ) : rows.length === 0 ? (
        <div className="text-text-muted">No stories</div>
      ) : (
        <StoryTreeList
          blocks={renderBlocks}
          planningRowId={planningRowId}
          selectedRowId={selectedRowId}
          collapsedStateIds={collapsedStateIds}
          isSearchActive={isSearchActive}
          isReorderDisabled={isSearchActive || sprintFilter.restricted || sprintFilter.status !== "ready"}
          pendingReorderId={reorder.isPending ? reorder.variables?.id ?? null : null}
          dragDrop={dragDrop}
          onSelect={handleSelect}
          onToggleExpand={handleToggleExpand}
          onToggleStateCollapsed={handleToggleStateCollapsed}
          onToggleStateConfiguration={handleToggleStateConfiguration}
          onToggleConversationConfiguration={handleToggleConversationConfiguration}
          TaskRow={TaskRow}
          StateHeaderRow={StateHeaderRow}
          ConversationsHeaderRow={ConversationsHeaderRow}
          LoadingPlaceholderRow={LoadingPlaceholderRow}
        />
      )}
    </PaneShell>
  );
}
