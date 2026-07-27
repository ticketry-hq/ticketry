import { useCallback, useEffect, useRef } from "react";
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
  | { kind: typeof HEADER; key: string; stateName: string; count: number };

export function TasksPane() {
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const loadDetails = useTasksStore((s) => s.loadDetails);
  const toggleExpanded = useUIStore((s) => s.toggleExpanded);
  const collapsedStateNames = useUIStore((s) => s.collapsedStateNames);
  const toggleStateCollapsed = useUIStore((s) => s.toggleStateCollapsed);

  const { rows, tasks, loadingTasks, isSearchActive } = useTaskTree();

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

  function renderRow(r: Row) {
    if ("kind" in r && r.kind === HEADER) {
      return (
        <StateHeaderRow
          key={r.key}
          stateName={r.stateName}
          count={r.count}
          isCollapsed={
            isSearchActive ? false : collapsedStateNames.has(r.stateName)
          }
          onToggle={handleToggleStateCollapsed}
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

    const row = r as FlatRow;
    return (
      <TaskRow
        key={row.task.id}
        row={row}
        isSelected={row.task.id === selectedTaskId}
        onClick={handleSelect}
        onToggleExpand={handleToggleExpand}
      />
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
          {rows.map(renderRow)}
        </ul>
      )}
    </PaneShell>
  );
}
