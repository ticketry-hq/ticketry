import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTasksStore } from "../../stores/tasksStore";
import { useUIStore } from "../../stores/uiStore";
import { TEMP_TASK_ID } from "../../../agents/types";
import type { TaskSummary } from "../../lib/types";
import { PaneShell } from "../../components/PaneShell";
import { TaskRow } from "./components/TaskRow";
import { StateHeaderRow } from "./components/StateHeaderRow";
import { LoadingPlaceholderRow } from "./components/LoadingPlaceholderRow";
import { IdeaEntry } from "./components/IdeaEntry";
import { StoriesSearchInput } from "./components/StoriesSearchInput";
import { useTaskTree } from "./hooks/useTaskTree";
import {
  useAxisDragAndDrop,
  type DragPayloadCodec,
} from "../../../../shared/dragDrop/useAxisDragAndDrop";
import {
  resolveTicketReorderNeighbors,
  type VisibleRootBlock,
} from "../../lib/ticketReorder";
import { orderedTaskSections } from "../../lib/taskTree";

export interface FlatRow {
  task: TaskSummary;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  descendantIds: string[];
}

export const PLACEHOLDER = Symbol("loading-placeholder");
export const HEADER = Symbol("state-header");

export type Row =
  | FlatRow
  | { kind: typeof PLACEHOLDER; key: string; depth: number }
  | {
      kind: typeof HEADER;
      key: string;
      stateId?: string | null;
      stateName: string;
      count: number;
    };

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
  | { kind: "row"; row: Exclude<Row, FlatRow> }
  | { kind: "block"; rows: FlatRow[] };

function groupRootBlocks(rows: Row[]): RenderBlock[] {
  const grouped: RenderBlock[] = [];
  for (const row of rows) {
    if ("kind" in row) {
      grouped.push({ kind: "row", row });
    } else if (row.depth === 0) {
      grouped.push({ kind: "block", rows: [row] });
    } else {
      const previous = grouped[grouped.length - 1];
      if (previous?.kind === "block") previous.rows.push(row);
    }
  }
  return grouped;
}

export function TasksPane() {
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const loadDetails = useTasksStore((s) => s.loadDetails);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const moveTaskWithinState = useTasksStore((s) => s.moveTaskWithinState);
  const moveTaskToState = useTasksStore((s) => s.moveTaskToState);
  const states = useTasksStore((s) => s.states);
  const pendingReorderTaskIds = useTasksStore(
    (s) => s.pendingReorderTaskIds,
  );
  const toggleExpanded = useUIStore((s) => s.toggleExpanded);
  const collapsedStateNames = useUIStore((s) => s.collapsedStateNames);
  const toggleStateCollapsed = useUIStore((s) => s.toggleStateCollapsed);

  const { rows, tasks, loadingTasks, isSearchActive } = useTaskTree();
  const renderBlocks = useMemo(() => groupRootBlocks(rows), [rows]);
  const visibleBlocks = useMemo<VisibleRootBlock[]>(
    () =>
      renderBlocks.flatMap((block) =>
        block.kind === "block"
          ? [{
              rootId: block.rows[0].task.id,
              rowIds: block.rows.map((row) => row.task.id),
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
      const source = tasks.find((task) => task.id === payload.taskId);
      if (!source || !selectedProjectId || !selectedModuleId) return;
      const headerStateId = resolved.targetId.startsWith("state:")
        ? resolved.targetId.slice("state:".length)
        : null;
      const target = headerStateId
        ? null
        : tasks.find((task) => task.id === resolved.targetId);
      const destinationState = headerStateId
        ? states.find((state) => state.id === headerStateId)
        : target?.state;
      if (!destinationState?.id) return;

      const sectionBlocks = visibleBlocks.filter((block) =>
        tasks.some(
          (task) =>
            task.id === block.rootId &&
            task.parent_id === selectedModuleId &&
            task.state.id === destinationState.id,
        ),
      );
      // Collapsed headers have no visible blocks. Rebuild their root-only
      // section from the ranked task list so a head drop still uses the real
      // first destination neighbor.
      const destinationBlocks =
        sectionBlocks.length > 0 || !headerStateId
          ? sectionBlocks
          : (orderedTaskSections(tasks, states).find(
              (section) => section.state.id === destinationState.id,
            )?.tasks ?? [])
              .filter((task) => task.parent_id === selectedModuleId)
              .map((task) => ({ rootId: task.id, rowIds: [task.id] }));
      const neighbors = resolveTicketReorderNeighbors(
        destinationBlocks,
        payload.taskId,
        headerStateId ? null : resolved.targetId,
        resolved.intent,
      );
      if (!neighbors) return;
      if (source.state.id === destinationState.id) {
        void moveTaskWithinState(
          payload.taskId,
          neighbors.beforeId,
          neighbors.afterId,
        );
      } else {
        void moveTaskToState(
          payload.taskId,
          destinationState,
          neighbors.beforeId,
          neighbors.afterId,
        );
      }
    },
    [
      moveTaskToState,
      moveTaskWithinState,
      selectedModuleId,
      selectedProjectId,
      states,
      tasks,
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
    useTasksStore.setState({ selectedTaskId: taskId });
  }, []);
  const handleToggleExpand = useCallback(
    (taskId: string) => {
      if (!isSearchActive) toggleExpanded(taskId);
    },
    [isSearchActive, toggleExpanded],
  );
  const handleToggleStateCollapsed = useCallback(
    (stateName: string) => {
      if (!isSearchActive) toggleStateCollapsed(stateName);
    },
    [isSearchActive, toggleStateCollapsed],
  );

  const detailsTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedProjectId || !selectedTaskId) return;

    if (selectedTaskId === TEMP_TASK_ID) {
      useTasksStore.setState({ details: null });
      return;
    }

    if (detailsTimerRef.current !== null) {
      window.clearTimeout(detailsTimerRef.current);
    }

    const projectId = selectedProjectId;
    const taskId = selectedTaskId;

    detailsTimerRef.current = window.setTimeout(() => {
      void loadDetails(projectId, taskId);
    }, 150);

    return () => {
      if (detailsTimerRef.current !== null) {
        window.clearTimeout(detailsTimerRef.current);
        detailsTimerRef.current = null;
      }
    };
  }, [selectedProjectId, selectedTaskId, loadDetails]);

  function renderNonTaskRow(r: Exclude<Row, FlatRow>) {
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
          count={r.count}
          isCollapsed={
            isSearchActive ? false : collapsedStateNames.has(r.stateName)
          }
          onToggle={handleToggleStateCollapsed}
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
    // Expansion is persisted on every real toggle. During a drag, hide only
    // the active root's descendants in this view so every drag termination
    // path restores them when the controller clears its payload.
    const renderedRows =
      dragDrop.payload?.taskId === root.task.id
        ? block.rows.slice(0, 1)
        : block.rows;
    const canDrag =
      root.task.id !== TEMP_TASK_ID &&
      root.parentId === null &&
      !pendingReorderTaskIds.has(root.task.id) &&
      !isSearchActive;
    const canTarget =
      root.task.id !== TEMP_TASK_ID &&
      !isSearchActive;
    const isTarget =
      canTarget &&
      dragDrop.targetId === root.task.id &&
      dragDrop.intent !== null &&
      dragDrop.payload?.taskId !== root.task.id;
    const targetProps = canTarget
      ? dragDrop.getDropTargetProps(root.task.id)
      : undefined;

    return (
      <li
        key={`block-${root.task.id}`}
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
              key={row.task.id}
              row={row}
              isSelected={row.task.id === selectedTaskId}
              onClick={handleSelect}
              onToggleExpand={handleToggleExpand}
              dragSourceProps={
                index === 0 && canDrag
                  ? dragDrop.getDragSourceProps({ taskId: row.task.id })
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
      {loadingTasks && tasks.length === 0 ? (
        <div className="text-text-muted">…</div>
      ) : tasks.length === 0 ? (
        <div className="text-text-muted">No stories</div>
      ) : (
        <ul role="tree" tabIndex={-1}>
          {renderBlocks.map(renderBlock)}
        </ul>
      )}
    </PaneShell>
  );
}
