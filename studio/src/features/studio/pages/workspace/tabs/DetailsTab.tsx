import { useEffect, useState } from "react";
import { useTasksStore } from "../../../stores/tasksStore";
import type { TaskSummary } from "../../../lib/types";
import { TEMP_TASK_ID } from "../../../../agents/types";
import {
  selectScratchLifecycleChips,
  useAgentStatusStore,
} from "../../../../agents/status";
import { LifecycleBadge } from "../../../../agents/terminal";
import { IssueDetail } from "../../../../work-items/issue-detail";

function ScratchDetails({
  projectId,
  moduleId,
}: {
  projectId: string | null;
  moduleId: string | null;
}) {
  const chips = useAgentStatusStore((status) =>
    projectId && moduleId
      ? selectScratchLifecycleChips(status, projectId, moduleId)
      : [],
  );

  if (chips.length === 0) {
    return <div className="text-text-muted">No active Scratch runs.</div>;
  }

  return (
    <span
      className="inline-flex min-w-0 flex-none items-center gap-1 overflow-hidden"
      data-testid="scratch-run-chicklets"
    >
      {chips.map((chip) => (
        <LifecycleBadge
          key={chip.state}
          state={chip.state}
          count={chip.count}
          showLabel={false}
          alwaysShowCount
        />
      ))}
    </span>
  );
}

// Mirror of the Tasks pane's selection debounce: rapid arrow-key navigation
// settles for 150 ms before the workspace mounts (and fetches) the issue.
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// The list row already carries every field this tab needs (id, parent,
// project, sequence, name), so the workspace renders straight from it instead
// of blocking on the separate details fetch.
function findTaskSummary(
  s: { tasks: TaskSummary[]; subtasks: Record<string, TaskSummary[]> },
  id: string | null,
): TaskSummary | null {
  if (!id) return null;
  const top = s.tasks.find((t) => t.id === id);
  if (top) return top;
  for (const list of Object.values(s.subtasks)) {
    const hit = list.find((t) => t.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Pinned, default-active tab. The ticket details themselves are the shared
 * Studio component (#827) — one rendering implementation for the Studio
 * drawer and Studio workspace. The scratch task shows its module's lifecycle
 * aggregate.
 */
export function DetailsTab() {
  const details = useTasksStore((s) => s.details);
  const loading = useTasksStore((s) => s.loading.details);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const debouncedTaskId = useDebouncedValue(selectedTaskId, 150);
  const summary = useTasksStore((s) => findTaskSummary(s, debouncedTaskId));

  if (selectedTaskId === TEMP_TASK_ID) {
    return (
      <ScratchDetails
        projectId={selectedProjectId}
        moduleId={selectedModuleId}
      />
    );
  }

  // Prefer the instantly-available row summary; the details payload is only
  // a fallback (it also still feeds ParentUpdate and reconcile paths).
  const task =
    summary ?? (details && details.task.id === debouncedTaskId ? details.task : null);
  if (!task) {
    if (debouncedTaskId !== selectedTaskId || loading) {
      return <div className="text-text-muted">…</div>;
    }
    return <div className="text-text-muted">No task selected</div>;
  }

  return <IssueDetail issueId={task.id} />;
}
