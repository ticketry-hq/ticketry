import { useTasksStore } from "../../../../../features/studio/stores/tasksStore";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import {
  selectScratchLifecycleChips,
  useAgentStatusStore,
} from "../../../../../features/agents/status";
import { ScratchStateBadge } from "../../../../../features/agents/lifecycle";
import IssueDetail from "./IssueDetail";

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

  return <ScratchStateBadge projectId={projectId} moduleId={moduleId} />;
}

/**
 * Pinned, default-active tab. A normal selection renders ticket details; the
 * scratch task shows its module's lifecycle aggregate.
 */
export function SelectedTicketDetails() {
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);

  if (selectedTaskId === TEMP_TASK_ID) {
    return (
      <ScratchDetails
        projectId={selectedProjectId}
        moduleId={selectedModuleId}
      />
    );
  }

  if (!selectedTaskId) {
    return <div className="text-text-muted">No task selected</div>;
  }

  // IssueDetail resolves this id from the canonical work-item owner during
  // render. Its refresh is deliberately post-paint, so selection itself never
  // waits for a request.
  return <IssueDetail issueId={selectedTaskId} />;
}
