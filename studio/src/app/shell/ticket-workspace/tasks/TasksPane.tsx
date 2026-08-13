import { useCallback, useMemo } from "react";
import { useClientStore } from "../../../../state/clientStore";
import { useStudioStore } from "../../../../features/projects";
import { useCachedStates } from "../../../../shared/query/stateCatalog";
import {
  isPlanningRow,
  LOADING_PLACEHOLDER as PLACEHOLDER,
  STATE_HEADER as HEADER,
  type PlanningRow as Row,
  type PlanningTreeRow as TreeRow,
  useStoriesTree,
  useReorderWorkItem,
  useSetWorkItemState,
} from "../../../../features/work-items";
import { TEMP_TASK_ID } from "../../../../features/agents/types";
import { PaneShell } from "../../PaneShell";
import { TaskRow } from "./components/TaskRow";
import { StateHeaderRow } from "./components/StateHeaderRow";
import { LoadingPlaceholderRow } from "./components/LoadingPlaceholderRow";
import { IdeaEntry } from "./components/IdeaEntry";
import { StoriesSearchInput } from "./components/StoriesSearchInput";
import {
  useAxisDragAndDrop,
  type DragPayloadCodec,
} from "../../../../shared/dragDrop/useAxisDragAndDrop";
import {
  resolveTicketReorderNeighbors,
  type VisibleRootBlock,
} from "./internal/ticketReorder";
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import type { WorkItem } from "../../../../shared/api/types";

export {
  isPlanningRow,
  type PlanningRow as Row,
  type PlanningTreeRow as TreeRow,
  type ScratchRow,
  type WorkItemRow,
} from "../../../../features/work-items";

export function planningRowId(row: Row): string {
  return row.kind === "work-item" ? row.id : TEMP_TASK_ID;
}

interface TicketDragPayload {
  taskId: string;
}

const stateDropTargetId = (stateId: string) => `state:${stateId}`;

const ticketDragCodec: DragPayloadCodec<TicketDragPayload> = {
  type: "application/x-ticketry-workflow-ticket",
  serialize: JSON.stringify,
  deserialize(serialized) {
    try {
      const value = JSON.parse(serialized) as unknown;
      return value &&
        typeof value === "object" &&
        typeof (value as { taskId?: unknown }).taskId === "string"
        ? { taskId: (value as { taskId: string }).taskId }
        : null;
    } catch {
      return null;
    }
  },
};

type RenderBlock =
  | { kind: "row"; row: Exclude<TreeRow, Row> }
  | { kind: "block"; rows: Row[] };

function groupRootBlocks(rows: TreeRow[]): RenderBlock[] {
  const grouped: RenderBlock[] = [];
  for (const row of rows) {
    if (!isPlanningRow(row)) {
      grouped.push({ kind: "row", row });
    } else if (row.kind === "scratch" || row.depth === 0) {
      grouped.push({ kind: "block", rows: [row] });
    } else {
      const previous = grouped[grouped.length - 1];
      if (previous?.kind === "block") previous.rows.push(row);
    }
  }
  return grouped;
}

export function TasksPane() {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const states = useCachedStates(selectedProjectId);
  const reorder = useReorderWorkItem({
    projectId: selectedProjectId ?? "",
    moduleId: selectedModuleId ?? "",
  });
  const setState = useSetWorkItemState();
  const toggleExpanded = useClientStore((s) => s.toggleExpanded);
  const collapsedStateIds = useClientStore((s) => s.collapsedStateIds);
  const toggleStateCollapsed = useClientStore((s) => s.toggleStateCollapsed);
  const toggleStateConfiguration = useClientStore(
    (s) => s.toggleStateConfiguration,
  );

  const {
    rows,
    tree,
    sectionIdsByState,
    loadingTasks,
    isSearchActive,
  } = useStoriesTree();
  const renderBlocks = useMemo(() => groupRootBlocks(rows), [rows]);
  const visibleBlocks = useMemo<VisibleRootBlock[]>(
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

  const handleDrop = useCallback(
    (
      payload: TicketDragPayload,
      resolved: { targetId: string; intent: "near" | "far" },
    ) => {
      const source = queryClient.getQueryData<WorkItem>(
        queryKeys.workItems.byId(payload.taskId),
      );
      if (!source || !selectedProjectId || !selectedModuleId) return;
      const headerStateId = resolved.targetId.startsWith("state:")
        ? resolved.targetId.slice("state:".length)
        : null;
      const target = headerStateId
        ? null
        : queryClient.getQueryData<WorkItem>(
            queryKeys.workItems.byId(resolved.targetId),
          );
      const destinationState = states.find(
        (state) => state.id === (headerStateId ?? target?.state),
      );
      if (!destinationState?.id) return;

      const sectionBlocks = visibleBlocks.filter((block) =>
        queryClient.getQueryData<WorkItem>(
          queryKeys.workItems.byId(block.rootId),
        )?.state === destinationState.id,
      );
      // Collapsed headers have no visible blocks. Rebuild their root-only
      // section from the ranked task list so a head drop still uses the real
      // first destination neighbor.
      const destinationBlocks =
        sectionBlocks.length > 0 || !headerStateId
          ? sectionBlocks
          : (sectionIdsByState[destinationState.id] ?? [])
              .map((id) => ({ rootId: id, rowIds: [id] }));
      const neighbors = resolveTicketReorderNeighbors(
        destinationBlocks,
        payload.taskId,
        headerStateId ? null : resolved.targetId,
        resolved.intent,
      );
      if (!neighbors) return;
      if (source.state === destinationState.id) {
        reorder.mutate({
          id: payload.taskId,
          beforeId: neighbors.beforeId,
          afterId: neighbors.afterId,
        });
      } else {
        setState.mutate(
          { id: payload.taskId, state: destinationState as typeof destinationState & { id: string } },
          {
            onSuccess: () => reorder.mutate({
              id: payload.taskId,
              beforeId: neighbors.beforeId,
              afterId: neighbors.afterId,
            }),
          },
        );
      }
    },
    [
      reorder,
      setState,
      selectedModuleId,
      selectedProjectId,
      states,
      sectionIdsByState,
      visibleBlocks,
    ],
  );
  const dragDrop = useAxisDragAndDrop<TicketDragPayload, string>({
    axis: "vertical",
    codec: ticketDragCodec,
    disabled:
      isSearchActive || !selectedProjectId || !selectedModuleId,
    onDrop: handleDrop,
  });

  // Stable, id-taking handlers so memoized rows don't re-render when the
  // pane does (e.g. on selection change).
  const handleSelect = useCallback((taskId: string) => {
    useClientStore.getState().selectTask(taskId);
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

  function renderNonTaskRow(r: Exclude<TreeRow, Row>) {
    if ("kind" in r && r.kind === HEADER) {
      const targetId = r.stateId ? stateDropTargetId(r.stateId) : null;
      const isTarget =
        targetId !== null &&
        dragDrop.targetId === targetId &&
        dragDrop.payload !== null;
      return (
        <StateHeaderRow
          key={r.key}
          stateName={r.stateName}
          stateColor={r.stateColor}
          count={r.count}
          isCollapsed={
            isSearchActive || !r.stateId
              ? false
              : collapsedStateIds.has(r.stateId)
          }
          onToggle={handleToggleStateCollapsed}
          onConfigure={handleToggleStateConfiguration}
          stateId={r.stateId}
          dropTargetProps={
            targetId && !isSearchActive
              ? dragDrop.getDropTargetProps(targetId)
              : undefined
          }
          showDropSeam={isTarget}
        />
      );
    }

    if ("kind" in r && r.kind === PLACEHOLDER) {
      return (
        <LoadingPlaceholderRow
          key={r.key}
          depth={r.depth}
        />
      );
    }

    return null;
  }

  function renderBlock(block: RenderBlock) {
    if (block.kind === "row") return renderNonTaskRow(block.row);
    const root = block.rows[0];
    const rootId = planningRowId(root);
    // Expansion is persisted on every real toggle. During a drag, hide only
    // the active root's descendants in this view so every drag termination
    // path restores them when the controller clears its payload.
    const renderedRows =
      dragDrop.payload?.taskId === rootId
        ? block.rows.slice(0, 1)
        : block.rows;
    const canDrag =
      root.kind === "work-item" &&
      root.parentId === null &&
      !(reorder.isPending && reorder.variables?.id === root.id) &&
      !isSearchActive;
    const canTarget =
      root.kind === "work-item" &&
      !isSearchActive;
    const isTarget =
      canTarget &&
      dragDrop.targetId === rootId &&
      dragDrop.intent !== null &&
      dragDrop.payload?.taskId !== rootId;
    const targetProps = canTarget
      ? dragDrop.getDropTargetProps(rootId)
      : undefined;

    return (
      <li
        key={`block-${rootId}`}
        role="none"
        className="relative"
        {...targetProps}
      >
        {isTarget ? (
          <span
            data-ticket-drop-seam
            data-testid="ticket-drop-seam"
            aria-hidden="true"
            className={`pointer-events-none absolute right-0 left-0 z-10 h-0.5 bg-focus-accent ${
              dragDrop.intent === "near" ? "top-0" : "bottom-0"
            }`}
          />
        ) : null}
        <ul role="group">
          {renderedRows.map((row, index) => (
            <TaskRow
              key={planningRowId(row)}
              row={row}
              isSelected={planningRowId(row) === selectedTaskId}
              onClick={handleSelect}
              onToggleExpand={handleToggleExpand}
              dragSourceProps={
                index === 0 && canDrag
                  ? dragDrop.getDragSourceProps({ taskId: rootId })
                  : undefined
              }
            />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <PaneShell pane="tasks">
      <StoriesSearchInput />
      <IdeaEntry />
      {loadingTasks && tree.order.length === 0 ? (
        <div className="text-text-muted">…</div>
      ) : !rows.some(isPlanningRow) ? (
        <div className="text-text-muted">No stories</div>
      ) : (
        <ul role="tree" tabIndex={-1}>
          {renderBlocks.map(renderBlock)}
        </ul>
      )}
    </PaneShell>
  );
}
