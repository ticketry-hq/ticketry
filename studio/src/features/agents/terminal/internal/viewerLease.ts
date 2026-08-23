import {
  studioRuntime,
  type WorkTrackerGraphQlExecute,
} from "../../../../runtime";
import { graphQlMutationError } from "../../../../shared/api/graphqlError";
import {
  CreateViewerLeaseDocument,
  DeleteViewerLeaseDocument,
  UpdateViewerLeaseDocument,
} from "../generated/viewerLeases";

export interface ViewerLeaseGrant {
  readonly generation: string;
}

export interface ViewerLeaseClient {
  acquire(
    agentRunId: string,
    viewerId: string,
    transport: "native" | "xterm",
  ): Promise<ViewerLeaseGrant>;
  renew(agentRunId: string, viewerId: string, generation: string): Promise<void>;
  release(agentRunId: string, viewerId: string, generation: string): Promise<void>;
}

export interface ViewerLease {
  readonly viewerId: string;
  acquire(): Promise<boolean>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

export function createViewerLease(
  client: ViewerLeaseClient,
  agentRunId: string,
  transport: "native" | "xterm",
): ViewerLease {
  const viewerId = viewerLeaseId();
  let acquirePromise: Promise<ViewerLeaseGrant> | null = null;
  let acquired = false;
  let generation: string | null = null;
  let releaseRequested = false;
  let releasePromise: Promise<void> | null = null;

  const releaseAcquiredLease = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    if (!acquired) return Promise.resolve();
    acquired = false;
    if (!generation) return Promise.resolve();
    releasePromise = client.release(agentRunId, viewerId, generation);
    return releasePromise;
  };

  return {
    viewerId,
    async acquire() {
      acquirePromise ??= client.acquire(agentRunId, viewerId, transport).then(async (lease) => {
        acquired = true;
        generation = lease.generation;
        if (releaseRequested) await releaseAcquiredLease();
        return lease;
      });
      await acquirePromise;
      return !releaseRequested;
    },
    renew() {
      if (!acquired || releaseRequested) return Promise.resolve();
      if (!generation) return Promise.resolve();
      return client.renew(agentRunId, viewerId, generation);
    },
    async release() {
      releaseRequested = true;
      if (acquired) {
        await releaseAcquiredLease();
        return;
      }
      if (!acquirePromise) return;
      await acquirePromise.catch(() => {});
      await releaseAcquiredLease();
    },
  };
}

/**
 * Viewer ownership is arbitrated by the Rust lease contract over the in-process
 * GraphQL transport. The `/api/terminals/viewers/lease` routes browser
 * development used to post to went away with the Python terminal authority, so
 * a platform without that transport holds no lease rather than a stale one.
 */
async function route<TResult>(
  operation: (execute: WorkTrackerGraphQlExecute) => Promise<TResult>,
): Promise<TResult> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      try {
        return await operation(execute);
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
}

/** Desktop's GraphQL ownership companion to the Tauri byte stream. */
export const desktopViewerLease: ViewerLeaseClient = {
  acquire(agentRunId, viewerId, transport) {
    return route(
      async (execute) =>
        (await execute(CreateViewerLeaseDocument, { agentRunId, viewerId, transport })).viewer_lease,
    );
  },
  renew(agentRunId, viewerId, generation) {
    return route(async (execute) => {
      await execute(UpdateViewerLeaseDocument, { agentRunId, viewerId, generation });
    });
  },
  async release(agentRunId, viewerId, generation) {
    await route(async (execute) => {
      await execute(DeleteViewerLeaseDocument, { agentRunId, viewerId, generation });
    });
  },
};

export function viewerLeaseId(): string {
  return `desktop-${crypto.randomUUID()}`;
}
