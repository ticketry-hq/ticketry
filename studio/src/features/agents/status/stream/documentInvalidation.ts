/**
 * Converging exactly the document registry a fact describes.
 *
 * A registry is keyed by its bucket — one Work Item's documents, or one
 * module's scratch workspace — so a fact about one of them must invalidate one
 * of them. Invalidating the whole `["documents", "registry"]` prefix would work,
 * and would also refetch every other bucket a person has open, including the
 * one they are reading. Publishing the bucket in the fact exists precisely so
 * that does not have to happen.
 *
 * Facts are batched for the same reason WorkItem facts are: an agent writing a
 * design directory publishes several in a row, and each one would otherwise
 * cost its own refetch of the same list.
 *
 * A removal is invalidated rather than evicted. Unlike a deleted WorkItem, the
 * cache entry is the *registry* rather than the document, and that registry
 * still exists and still has to be re-read to lose one row.
 */
import { studioApolloClient } from "../../../../shared/apollo/client";
import {
  ScratchDocumentRegistryDocument,
  TaskDocumentRegistryDocument,
} from "../../../documents/generated/documentRegistry.documents";

export const DOCUMENT_INVALIDATION_WINDOW_MS = 50;

/** The bucket one registry cache entry belongs to. */
export interface DocumentRegistryKey {
  readonly scope: "task" | "scratch";
  readonly ownerId: string;
}

export interface DocumentInvalidator {
  /** Queue one bucket. Repeats inside the window cost one refetch. */
  record(bucket: DocumentRegistryKey): void;
  /** Apply everything queued now, ignoring the window. */
  flush(): void;
  /** Drop everything queued; used when the feed stops or switches project. */
  cancel(): void;
}

export function createDocumentInvalidator(
  windowMs: number = DOCUMENT_INVALIDATION_WINDOW_MS,
): DocumentInvalidator {
  // Keyed by scope and owner, so a burst about one bucket collapses to one.
  const pending = new Map<string, DocumentRegistryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const buckets = [...pending.values()];
    pending.clear();
    for (const bucket of buckets) {
      const queryName = bucket.scope === "task"
        ? "TaskDocumentRegistry"
        : "ScratchDocumentRegistry";
      const variable = bucket.scope === "task" ? "taskId" : "moduleId";
      void studioApolloClient().refetchQueries({
        include: "active",
        onQueryUpdated(observableQuery) {
          if (observableQuery.queryName !== queryName) return false;
          const variables = observableQuery.variables as Record<string, unknown>;
          return variables[variable] === bucket.ownerId
            ? observableQuery.refetch()
            : false;
        },
      });
    }
  };

  return {
    record(bucket) {
      pending.set(`${bucket.scope}:${bucket.ownerId}`, bucket);
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export function refreshDocumentRegistries(): Promise<void> {
  return studioApolloClient()
    .refetchQueries({
      include: [
        TaskDocumentRegistryDocument,
        ScratchDocumentRegistryDocument,
      ],
    })
    .then(() => undefined);
}
