/**
 * The authoritative refresh a reset performs before it trusts anything local.
 *
 * A reset means the retained cursor cannot be honoured, so no cached holding
 * can be assumed to be a correct base for the facts that follow. Every
 * canonical holding is therefore re-read from the server before the supplied
 * high-water cursor is installed as the new baseline.
 *
 * Agent Run holdings and Automation Attempts are re-read by the handshake
 * itself: the connection publishes `RunStatusSnapshot` — a fresh server read at
 * the very cursor the reset hands back — immediately before the reset frame.
 * That snapshot IS the canonical refetch of those two holdings, so this module
 * requires it rather than paying a second round-trip for rows the same
 * connection just delivered. A reset arriving without one is a refresh failure,
 * not a reason to baseline over stale runs.
 *
 * Everything else the surface reads is outside the outbox, so it is refetched
 * here: WorkItem collections and entities, the workflow catalogue, the
 * document registry, and every visible worktree holding. Worktree status is
 * live Git rather than a stored row, so a reset is exactly the moment it has to
 * be re-read: the facts that would have moved it are the ones the server has
 * just refused to replay. Failures propagate — the caller closes and retries
 * the subscription rather than silently baselining.
 */
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";

/** Cached WorkItem entities and the collections that contain them. */
const WORK_ITEM_ENTITY_PREFIX = ["workItem"] as const;
const WORK_ITEM_COLLECTION_PREFIX = ["work-items"] as const;
const DOCUMENT_REGISTRY_PREFIX = ["documents", "registry"] as const;
const TERMINAL_HOLDINGS_PREFIX = ["terminal-sessions"] as const;

export interface CanonicalRefreshRequest {
  readonly projectId: string;
  /**
   * The cursor of the snapshot delivered by the handshake that produced this
   * reset, or null when the reset arrived without one.
   */
  readonly snapshotCursor: number | null;
}

export class StaleHoldingsError extends Error {
  constructor() {
    super("The reset arrived without an authoritative snapshot.");
    this.name = "StaleHoldingsError";
  }
}

export async function refreshCanonicalHoldings(
  request: CanonicalRefreshRequest,
): Promise<void> {
  if (request.snapshotCursor === null) throw new StaleHoldingsError();
  // `refetchType: "active"` re-reads exactly what a surface is displaying and
  // marks everything else stale for its next mount. A cache entry with no
  // observer has nothing to paint over, and entries written directly by a feed
  // have no query function to refetch with — awaiting those would fail every
  // reset for a holding nobody is looking at.
  const refetch = (queryKey: readonly unknown[]) =>
    queryClient.invalidateQueries(
      { queryKey, refetchType: "active" },
      { throwOnError: true },
    );
  await Promise.all([
    refetch(queryKeys.tasks.all),
    refetch(WORK_ITEM_ENTITY_PREFIX),
    refetch(WORK_ITEM_COLLECTION_PREFIX),
    // The workflow catalogue is two cached reads: the normalized catalogue and
    // the state list every surface selects from.
    refetch(queryKeys.workflows.catalog(request.projectId)),
    refetch(queryKeys.states.byProject(request.projectId)),
    refetch(DOCUMENT_REGISTRY_PREFIX),
    refetch(TERMINAL_HOLDINGS_PREFIX),
    refetch(queryKeys.worktrees.all),
  ]);
}
