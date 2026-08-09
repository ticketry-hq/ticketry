import { agentApiUrl } from "../../../../runtime";
import { apiKey } from "../../../../shared/api/client";

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

async function request(path: string, body: Record<string, string>): Promise<void> {
  const key = apiKey();
  const response = await fetch(agentApiUrl(path), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { detail?: { error?: string } } | null;
  const error = new Error(payload?.detail?.error ?? `HTTP ${response.status}`) as Error & { code?: string };
  error.code = payload?.detail?.error;
  throw error;
}

/** Desktop's small control-plane companion to the native byte stream. */
export const desktopViewerLease: ViewerLeaseClient = {
  acquire(agentRunId, viewerId) {
    return request("/api/terminals/viewers/lease", {
      agent_run_id: agentRunId,
      viewer_id: viewerId,
      transport: "desktop",
    });
  },
  renew(agentRunId, viewerId) {
    return request("/api/terminals/viewers/lease/renew", {
      agent_run_id: agentRunId,
      viewer_id: viewerId,
    });
  },
  release(agentRunId, viewerId) {
    return request("/api/terminals/viewers/lease/release", {
      agent_run_id: agentRunId,
      viewer_id: viewerId,
    });
  },
};

export function viewerLeaseId(): string {
  return `desktop-${crypto.randomUUID()}`;
}
