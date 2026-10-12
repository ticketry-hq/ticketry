import { NO_WORKFLOW_MESSAGE } from "../../../../../features/workflows";

/** Replaces the story list while the project has no states or task-level types. */
export function NoWorkflowNotice() {
  return (
    <p role="status" data-testid="no-workflow-notice" className="text-text-muted">
      {NO_WORKFLOW_MESSAGE}
    </p>
  );
}
