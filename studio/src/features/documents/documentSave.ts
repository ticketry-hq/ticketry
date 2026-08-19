import { ApiError, saveDocument as saveThroughHost } from "../../shared/api/client";
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
    rest: () => saveThroughLegacyHost(request),
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

/**
 * Browser-only development has no in-process runtime, so it keeps talking to
 * the legacy host route. That route reports a stale save as HTTP 409 carrying
 * the current digest, which is the same answer in a different envelope.
 */
async function saveThroughLegacyHost(
  request: DocumentSaveRequest,
): Promise<DocumentSaveResult> {
  try {
    const saved = await saveThroughHost(request.documentId, {
      content: request.content,
      digest: request.expectedDigest,
    });
    return { digest: saved.digest, saved: true, stale: false };
  } catch (reason) {
    const digest = staleDigest(reason);
    if (!digest) throw reason;
    return { digest, saved: false, stale: true };
  }
}

function staleDigest(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  if (!error.body || typeof error.body !== "object") return null;
  const detail = (error.body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const digest = (detail as { digest?: unknown }).digest;
  return typeof digest === "string" && digest ? digest : null;
}
