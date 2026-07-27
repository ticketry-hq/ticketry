import { agentApiUrl } from "../../../../runtime";

export interface ViewerLeaseClient {
  acquire(agentRunId: string, viewerId: string): Promise<void>;
  renew(agentRunId: string, viewerId: string): Promise<void>;
  release(agentRunId: string, viewerId: string): Promise<void>;
}

async function request(path: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(agentApiUrl(path), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
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
