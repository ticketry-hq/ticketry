import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import { authenticatedHostFetch } from "../../../shared/api/authenticatedHostFetch";
import {
  createTerminalSession,
  resumeTerminalSession,
  terminateTerminalSession,
  type ResumeTerminalRunInput,
} from "../terminal/internal/mutationTransport";

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
  const response = await authenticatedHostFetch(path, init);
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
  return request<ResumableTerminalSession[]>(
    `/api/terminals/resumable?${params}`,
    { signal },
  );
};
export const getScratchTerminals = (
  projectId: string,
  moduleId?: string,
  signal?: AbortSignal,
) => {
  const url = `/api/terminals/scratch?project_id=${encodeURIComponent(projectId)}${moduleId ? `&module_id=${encodeURIComponent(moduleId)}` : ""}`;
  return request<PersistedTerminalSession[]>(url, { signal });
};
export const terminateTerminal = terminateTerminalSession;
export const resumeTerminal = (input: ResumeTerminalRunInput) =>
  resumeTerminalSession(input);
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
  createTerminalSession({
    agent: body.agent,
    projectId: body.project_id,
    moduleId: body.module_id,
    taskId: body.task_id,
    initialPrompt: body.is_instant ? body.instant_prompt : body.initial_prompt,
    isPlanning: body.is_planning,
    isInstant: body.is_instant,
  });
