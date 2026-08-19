import { studioRuntime } from "../../runtime";

/**
 * Where a registered document's bytes live for this platform.
 *
 * Studio never builds this URL itself: the desktop serves documents from its
 * own read-only protocol and browser development reads them over the legacy
 * host route, and only the runtime knows which of the two it is.
 */
export function documentUrl(documentId: string, relPath: string): string {
  return studioRuntime().documentUrl(documentId, relPath);
}
