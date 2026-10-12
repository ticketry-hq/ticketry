import { clearStorySprintFilter } from "../internal/storySprintFilterStore";
import { editionHas } from "../../../shared/config/edition";

/** Capture feedback keeps the selected Story and its text search intact. */
export function CapturedIdeaRecovery({ projectId, onDismiss }: { projectId: string; onDismiss: () => void }) {
  return <div role="status" aria-label="Idea captured outside results" className="mt-2 text-xs text-text-muted">
    <p>Idea captured outside the current results.</p>
    {editionHas("sprintPlanning") ? <button type="button" onClick={() => { clearStorySprintFilter(projectId); onDismiss(); }}
      className="mt-1 border border-pane-border px-2 py-1 text-text-primary">Show all sprints</button> : null}
  </div>;
}
