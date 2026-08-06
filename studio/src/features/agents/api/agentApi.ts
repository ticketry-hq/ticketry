import type {
  DesignDoc,
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import { agentApiUrl } from "../../../runtime";
export { documentUrl as docUrl } from "../../../shared/api/documentUrl";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(agentApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body
      ? String((body as { message?: string }).message)
      : `HTTP ${response.status}`;
    throw new ApiError(response.status, message, body);
  }
  return body as T;
}

export const getModuleActivity = (projectId: string): Promise<Record<string, string>> =>
  request<Record<string, string>>(`/api/runs/module-activity?project_id=${encodeURIComponent(projectId)}`).catch(() => ({}));
export const getTerminals = (taskId: string, signal?: AbortSignal) => {
  const url = `/api/terminals?task_id=${encodeURIComponent(taskId)}`;
  return request<PersistedTerminalSession[]>(url, { signal });
};
export const listResumableTerminals = (
  taskId?: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
) => {
  const params = new URLSearchParams();
  if (taskId) params.set("task_id", taskId);
  if (projectId) params.set("project_id", projectId);
  if (moduleId) params.set("module_id", moduleId);
  return request<ResumableTerminalSession[]>(`/api/terminals/resumable?${params}`, { signal });
};
export const getScratchTerminals = (
  projectId: string,
  moduleId?: string,
  signal?: AbortSignal,
) => {
  const url = `/api/terminals/scratch?project_id=${encodeURIComponent(projectId)}${moduleId ? `&module_id=${encodeURIComponent(moduleId)}` : ""}`;
  return request<PersistedTerminalSession[]>(url, { signal });
};
export const terminateTerminal = (agentRunId: string) =>
  request<{ agent_run_id: string; terminated: boolean }>(`/api/terminals?agent_run_id=${encodeURIComponent(agentRunId)}`, { method: "DELETE" });
export const resumeTerminal = (agentRunId: string) =>
  request<{ agent_run_id: string; resumed_from: string }>(`/api/terminals/resume?agent_run_id=${encodeURIComponent(agentRunId)}`, { method: "POST" });

export interface CreateTerminalRunRequest {
  agent: "claude" | "agy" | "codex" | "gemini";
  project_id: string;
  module_id: string;
  task_id: string | null;
  initial_prompt: string | null;
  is_planning: boolean;
  is_instant: boolean;
  instant_prompt: string | null;
}

export const createTerminalRun = (body: CreateTerminalRunRequest) =>
  request<{ agent_run_id: string }>("/api/terminals", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getDocuments = (
  taskId: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
) => {
  const params = new URLSearchParams({ task_id: taskId });
  if (projectId) params.set("project_id", projectId);
  if (moduleId) params.set("module_id", moduleId);
  const url = `/api/documents?${params}`;
  return request<{ documents: DesignDoc[] }>(url, { signal });
};
export const getScratchDocuments = (moduleId: string, signal?: AbortSignal) => {
  const url = `/api/documents?scope=scratch&module_id=${encodeURIComponent(moduleId)}`;
  return request<{ documents: DesignDoc[] }>(url, { signal });
};
export const fsComplete = (path: string, signal?: AbortSignal) =>
  request<{ entries: string[] }>(`/api/fs/complete?path=${encodeURIComponent(path)}`, { signal });
