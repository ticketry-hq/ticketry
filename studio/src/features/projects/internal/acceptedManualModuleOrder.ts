/**
 * Projects the server has already taken manual, remembered locally until an
 * authoritative project read can confirm it (#367).
 *
 * A project flips to Manual module order on the server the moment it accepts a
 * first reorder. Studio learns that from the project list, which is re-read
 * alongside the modules once the write settles. When that project read fails,
 * the only thing left describing the project is the cached list — and it still
 * says automatic, which would layer agent-activity recency back over the rank
 * order the server just persisted and visually undo the accepted drag.
 *
 * So an accepted reorder records the mode it implies here. The record is a
 * fallback only: it is consulted when the project read fails, and dropped the
 * moment an authoritative read answers — whichever way it answers, since the
 * server is allowed to have taken the project back to automatic.
 */

const acceptedProjectIds = new Set<string>();

/** Record that the server accepted a reorder, so this project is now manual. */
export function markManualModuleOrderAccepted(projectId: string): void {
  acceptedProjectIds.add(projectId);
}

/** Drop the record: an authoritative mode has answered, or the project is gone. */
export function forgetAcceptedManualModuleOrder(projectId: string): void {
  acceptedProjectIds.delete(projectId);
}

/** True while an accepted reorder is still the best mode this client has. */
export function hasAcceptedManualModuleOrder(projectId: string): boolean {
  return acceptedProjectIds.has(projectId);
}

/** Test seam: forget every remembered project. */
export function resetAcceptedManualModuleOrder(): void {
  acceptedProjectIds.clear();
}
