import { studioRuntime } from "../../runtime";
import { SaveDesignDocumentDocument } from "./generated/documentSave";

/**
 * Studio's digest-guarded document save.
 *
 * A save is an operation with an identity, not a blind write: it names the
 * version the editor loaded, and the runtime replaces the file only if that
 * version is still on disk. Losing that race is an ordinary answer rather than
 * an error — the draft stays in the editor and `digest` is the version the
 * file actually holds, so the same edit can be applied deliberately against it.
 *
 * Reusing `operationId` for the same bytes replays the durable answer instead
 * of writing twice, which is what makes a retried request safe.
 */

export interface DocumentSaveRequest {
  readonly documentId: string;
  readonly expectedDigest: string;
  readonly content: string;
  readonly operationId: string;
}

export interface DocumentSaveResult {
  /** The digest the document holds after this attempt. */
  readonly digest: string;
  /** True when the submitted content is the version on disk. */
  readonly saved: boolean;
  /** True when the document had already changed and was left untouched. */
  readonly stale: boolean;
}

/** A fresh identity for one save intent. */
export function newSaveOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Development browsers without a secure context still need a unique, stable
  // identity per intent; it is compared, never trusted as randomness.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function saveDocument(
  request: DocumentSaveRequest,
): Promise<DocumentSaveResult> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const outcome = (await execute(SaveDesignDocumentDocument, {
        documentId: request.documentId,
        expectedDigest: request.expectedDigest,
        content: request.content,
        operationId: request.operationId,
      })).save_design_document;
      return {
        digest: outcome.digest,
        saved: outcome.saved,
        stale: outcome.stale,
      };
    },
  });
}
