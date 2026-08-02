import { useTasksStore } from "../../../stores/tasksStore";
import { TEMP_TASK_ID } from "../../../../agents/types";
import {
  selectScratchLifecycleChips,
  useAgentStatusStore,
} from "../../../../agents/status";
import { ScratchStateBadge } from "../../../../agents/lifecycle";
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

  return <ScratchStateBadge projectId={projectId} moduleId={moduleId} />;
}

/**
 * Pinned, default-active tab. The ticket details themselves are the shared
 * Studio component (#827) — one rendering implementation for the Studio
 * drawer and Studio workspace. The scratch task shows its module's lifecycle
 * aggregate.
 */
export function DetailsTab() {
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
