/**
 * Document availability across a stream boundary.
 *
 * Design documents now publish durable, project-scoped facts, so a live change
 * converges one registry through `documentInvalidation`. This module covers the
 * other half: the boundary at which the client cannot know what it missed.
 *
 * Replay ends at `caughtUp`, and a reset says the retained cursor is unusable.
 * At both, the honest position is that any registry may be stale — a document
 * could have been written while the connection was down, or its fact could sit
 * below a compacted cursor that will never be replayed. So every registry is
 * refreshed authoritatively rather than reasoned about. It is the same query
 * the surface already reads, and it is what makes the scoped invalidation above
 * an optimization rather than the only thing standing between a person and a
 * document that silently never appeared.
 */
import { queryClient } from "../../../../shared/query/queryClient";

const REGISTRY_PREFIX = ["documents", "registry"] as const;

export function refreshDocumentRegistries(): void {
  void queryClient.invalidateQueries({ queryKey: REGISTRY_PREFIX });
}
