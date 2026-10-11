import { getStorySprintReadsSnapshot } from "../sprints";
import { getStorySprintFilterGeneration, getStorySprintFilterIntent } from "../work-items";

/** Initial discovery fills an unknown scope; it does not replace a user's scope. */
export function captureCreationFilterScope(projectId: string): () => boolean {
  const intent = getStorySprintFilterIntent(projectId);
  let generation = getStorySprintFilterGeneration(projectId);
  let initialResolutionPending = intent.mode === "active"
    && !getStorySprintReadsSnapshot(projectId).active.ready;
  return () => {
    if (getStorySprintFilterIntent(projectId) !== intent) return false;
    const currentGeneration = getStorySprintFilterGeneration(projectId);
    if (currentGeneration === generation) return true;
    if (initialResolutionPending && currentGeneration === generation + 1
      && getStorySprintReadsSnapshot(projectId).active.ready) {
      generation = currentGeneration;
      initialResolutionPending = false;
      return true;
    }
    return false;
  };
}
