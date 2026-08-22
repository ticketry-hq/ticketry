import {
  studioRuntime,
  type WorkTrackerGraphQlExecute,
} from "../../../../runtime";
import { graphQlMutationError } from "../../../../shared/api/graphqlError";
import { authenticatedHostFetch } from "../../../../shared/api/authenticatedHostFetch";
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

async function browserRequest(
  path: string,
  body: Record<string, string>,
): Promise<void> {
  const response = await authenticatedHostFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as {
    detail?: { error?: string };
  } | null;
  const error = new Error(
    payload?.detail?.error ?? `HTTP ${response.status}`,
  ) as Error & { code?: string };
  error.code = payload?.detail?.error;
  throw error;
}

async function route<TResult>(
  browser: () => Promise<TResult>,
  operation: (execute: WorkTrackerGraphQlExecute) => Promise<TResult>,
): Promise<TResult> {
  return studioRuntime().writeWorkTracker({
    rest: browser,
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
      async () => {
        await browserRequest("/api/terminals/viewers/lease", {
          agent_run_id: agentRunId,
          viewer_id: viewerId,
          transport: transport === "native" ? "desktop" : "xterm",
        });
        return { generation: viewerId };
      },
      async (execute) =>
        (await execute(CreateViewerLeaseDocument, { agentRunId, viewerId, transport })).viewer_lease,
    );
  },
  renew(agentRunId, viewerId, generation) {
    return route(
      () => browserRequest("/api/terminals/viewers/lease/renew", {
        agent_run_id: agentRunId,
        viewer_id: viewerId,
      }),
      async (execute) => {
        await execute(UpdateViewerLeaseDocument, { agentRunId, viewerId, generation });
      },
    );
  },
  async release(agentRunId, viewerId, generation) {
    await route(
      () => browserRequest("/api/terminals/viewers/lease/release", {
        agent_run_id: agentRunId,
        viewer_id: viewerId,
      }),
      async (execute) => {
        await execute(DeleteViewerLeaseDocument, { agentRunId, viewerId, generation });
      },
    );
  },
};

export function viewerLeaseId(): string {
  return `desktop-${crypto.randomUUID()}`;
}
