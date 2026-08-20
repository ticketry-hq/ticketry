import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { TransportEnum } from "@worktracker/typescript-sdk/models";
import { apiBase, apiKey } from "../../../../shared/api/client";

export interface ViewerLeaseClient {
  acquire(agentRunId: string, viewerId: string): Promise<void>;
  renew(agentRunId: string, viewerId: string): Promise<void>;
  release(agentRunId: string, viewerId: string): Promise<void>;
}

export interface ViewerLease {
  acquire(): Promise<boolean>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

export function createViewerLease(
  client: ViewerLeaseClient,
  agentRunId: string,
): ViewerLease {
  const viewerId = viewerLeaseId();
  let acquirePromise: Promise<void> | null = null;
  let acquired = false;
  let releaseRequested = false;
  let releasePromise: Promise<void> | null = null;

  const releaseAcquiredLease = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    if (!acquired) return Promise.resolve();
    acquired = false;
    releasePromise = client.release(agentRunId, viewerId);
    return releasePromise;
  };

  return {
    async acquire() {
      acquirePromise ??= client.acquire(agentRunId, viewerId).then(async () => {
        acquired = true;
        if (releaseRequested) await releaseAcquiredLease();
      });
      await acquirePromise;
      return !releaseRequested;
    },
    renew() {
      if (!acquired || releaseRequested) return Promise.resolve();
      return client.renew(agentRunId, viewerId);
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

const terminalsApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).terminals;

async function request(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (cause) {
    if (!(cause instanceof WorkTrackerApiError)) throw cause;
    const payload = cause.body as
      | { code?: string; detail?: string | { error?: string } }
      | null;
    const code =
      payload?.code ??
      (typeof payload?.detail === "object" ? payload.detail.error : undefined);
    const error = new Error(code ?? `HTTP ${cause.status}`) as Error & {
      code?: string;
    };
    error.code = code;
    throw error;
  }
}

/** Desktop's small control-plane companion to the native byte stream. */
export const desktopViewerLease: ViewerLeaseClient = {
  acquire(agentRunId, viewerId) {
    return request(() =>
      terminalsApi().terminalsViewersLeaseCreate({
        viewerLeaseRequest: {
          agent_run_id: agentRunId,
          viewer_id: viewerId,
          transport: TransportEnum.desktop,
        },
      }),
    );
  },
  renew(agentRunId, viewerId) {
    return request(() =>
      terminalsApi().terminalsViewersLeaseRenewCreate({
        viewerLeaseIdentity: {
          agent_run_id: agentRunId,
          viewer_id: viewerId,
        },
      }),
    );
  },
  release(agentRunId, viewerId) {
    return request(() =>
      terminalsApi().terminalsViewersLeaseReleaseCreate({
        viewerLeaseIdentity: {
          agent_run_id: agentRunId,
          viewer_id: viewerId,
        },
      }),
    );
  },
};

export function viewerLeaseId(): string {
  return `desktop-${crypto.randomUUID()}`;
}
