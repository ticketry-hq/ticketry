const listeners = new Set<(projectId: string) => void>();

/** Local lifecycle writes notify project-scoped readers without owning records. */
export function subscribeSprintChoicesRefresh(listener: (projectId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function refreshSprintChoices(projectId: string): void {
  invalidateSprintHistory(projectId);
  for (const listener of listeners) listener(projectId);
}
import { invalidateSprintHistory } from "./sprintHistoryMetadata";
