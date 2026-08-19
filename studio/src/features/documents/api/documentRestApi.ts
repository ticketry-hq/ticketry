import { authenticatedHostFetch } from "../../../shared/api/authenticatedHostFetch";
import type { DesignDoc } from "../types";

/**
 * The legacy host document routes.
 *
 * These exist for browser-only development, which has no in-process runtime to
 * ask. Desktop Studio never reaches them: its runtime routes every document read
 * to GraphQL and to the desktop document protocol, and the host refuses these
 * paths outright once it is told Rust owns the workspace tables. The cutover
 * acceptance case proves production opens no HTTP connection at all.
 */

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await authenticatedHostFetch(path, { signal });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Document request failed: HTTP ${response.status}`);
  }
  return body as T;
}

export function listTaskDocuments(
  taskId: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
): Promise<DesignDoc[]> {
  const params = new URLSearchParams({ task_id: taskId });
  if (projectId) params.set("project_id", projectId);
  if (moduleId) params.set("module_id", moduleId);
  return request<{ documents: DesignDoc[] }>(`/api/documents?${params}`, signal)
    .then((payload) => payload.documents);
}

export function listScratchDocuments(
  moduleId: string,
  signal?: AbortSignal,
): Promise<DesignDoc[]> {
  const params = new URLSearchParams({ scope: "scratch", module_id: moduleId });
  return request<{ documents: DesignDoc[] }>(`/api/documents?${params}`, signal)
    .then((payload) => payload.documents);
}

export function completeDirectories(
  path: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return request<{ entries: string[] }>(
    `/api/fs/complete?path=${encodeURIComponent(path)}`,
    signal,
  ).then((payload) => payload.entries);
}
