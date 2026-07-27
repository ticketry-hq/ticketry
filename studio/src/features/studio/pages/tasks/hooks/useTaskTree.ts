import { useMemo } from "react";
import { useTasksStore } from "../../../stores/tasksStore";
import { useUIStore } from "../../../stores/uiStore";
import { orderedTaskSections } from "../../../lib/taskTree";
import { type TaskSummary } from "../../../lib/types";
import { formatSequenceId } from "../../../lib/planeUrl";
import { TEMP_TASK_ID } from "../../../../agents/types";
import {
  type Row,
  HEADER,
  PLACEHOLDER,
} from "../TasksPane";

export function useTaskTree() {
  const tasks = useTasksStore((s) => s.tasks);
  const states = useTasksStore((s) => s.states);
  const subtasks = useTasksStore((s) => s.subtasks);
  const loadingTasks = useTasksStore((s) => s.loading.tasks);
  const loadingSubtasks = useTasksStore((s) => s.loading.subtasks);
  const expandedTaskIds = useUIStore((s) => s.expandedTaskIds);
  const collapsedStateNames = useUIStore((s) => s.collapsedStateNames);
  const storySearchQuery = useUIStore((s) => s.storySearchQuery);
  const normalizedQuery = storySearchQuery.trim().toLowerCase();
  const isSearchActive = normalizedQuery.length > 0;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const visibleTaskIds = new Set<string>();
    const matchingChildren = new Map<string, TaskSummary[]>();

    function matchesQuery(task: TaskSummary): boolean {
      return (
        task.name.toLowerCase().includes(normalizedQuery) ||
        formatSequenceId(task.sequence_id)
          .toLowerCase()
          .includes(normalizedQuery)
      );
    }

    function keepMatchingBranch(
      task: TaskSummary,
      ancestorIds: Set<string>,
    ): boolean {
      if (ancestorIds.has(task.id)) return matchesQuery(task);

      const children = subtasks[task.id];
      if (children === undefined) return matchesQuery(task);

      const nextAncestorIds = new Set(ancestorIds).add(task.id);
      const keptChildren = children.filter((child) =>
        keepMatchingBranch(child, nextAncestorIds),
      );
      matchingChildren.set(task.id, keptChildren);
      return matchesQuery(task) || keptChildren.length > 0;
    }

    // Status stays in its own store; rows carry only the stable task IDs used
    // to derive a collapsed summary. The iterative walk also tolerates cycles.
    function collectDescendantIds(taskId: string): string[] {
      const ids: string[] = [];
      const visited = new Set([taskId]);
      const pending = [...(subtasks[taskId] ?? [])];
      while (pending.length > 0) {
        const child = pending.pop();
        if (!child || visited.has(child.id)) continue;
        visited.add(child.id);
        ids.push(child.id);
        pending.push(...(subtasks[child.id] ?? []));
      }
      return ids;
    }

    // Helper: Recursively pushes subtasks to output array when nodes are expanded
    function pushRecursive(
      task: TaskSummary,
      depth: number,
      parentId: string | null,
    ) {
      if (visibleTaskIds.has(task.id)) return;
      visibleTaskIds.add(task.id);
      const hasChildren = task.sub_issues_count > 0;
      const children = isSearchActive
        ? matchingChildren.get(task.id)
        : subtasks[task.id];
      const isExpanded = isSearchActive
        ? children === undefined
          ? expandedTaskIds.has(task.id)
          : children.length > 0
        : expandedTaskIds.has(task.id);
      const isLoading =
        isExpanded && subtasks[task.id] === undefined && loadingSubtasks;

      out.push({
        task,
        depth,
        parentId,
        hasChildren,
        isExpanded,
        isLoading,
        descendantIds: isExpanded ? [] : collectDescendantIds(task.id),
      });

      // If the node is expanded and has children, push children recursively
      if (hasChildren && isExpanded) {
        const kids = children;
        if (kids === undefined) {
          // If kids are not loaded yet, inject a temporary loading placeholder
          out.push({
            kind: PLACEHOLDER,
            key: `${task.id}-loading`,
            depth: depth + 1,
          });
        } else {
          // Push children recursively incrementing tree depth
          for (const k of kids) {
            pushRecursive(k, depth + 1, task.id);
          }
        }
      }
    }

    // Group tasks into buckets sorted by state and reverse bucket order to match TUI parity
    for (const { state, tasks: ordered } of orderedTaskSections(tasks, states)) {
      const visible = isSearchActive
        ? ordered.filter(
            (task) =>
              task.id === TEMP_TASK_ID ||
              keepMatchingBranch(task, new Set()),
          )
        : ordered;
      if (isSearchActive && visible.length === 0) continue;

      // Inject the state section header (e.g. Backlog, In Progress)
      out.push({
        kind: HEADER,
        key: `header-${state.id ?? state.name}`,
        stateName: state.name,
        count: ordered.length,
      });

      // A collapsed section shows only its header (count intact) so the user
      // can unfocus a state like Done without losing the at-a-glance tally.
      if (!isSearchActive && collapsedStateNames.has(state.name)) continue;

      // TUI parity: list(reversed(...)) to show newly created tasks at the bottom/top correctly
      for (const t of visible) pushRecursive(t, 0, null);
    }
    return out;
  }, [
    tasks,
    states,
    subtasks,
    expandedTaskIds,
    loadingSubtasks,
    collapsedStateNames,
    normalizedQuery,
    isSearchActive,
  ]);

  return {
    rows,
    tasks,
    loadingTasks,
    isSearchActive,
  };
}
