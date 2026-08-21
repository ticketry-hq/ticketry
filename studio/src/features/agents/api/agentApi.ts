import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type {
  DesignDoc,
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import { apiBase, apiKey } from "../../../shared/api/client";
export { documentUrl as docUrl } from "../../../shared/api/documentUrl";

const documentsApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).documents;
const terminalsApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).terminals;

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

async function terminalCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkTrackerApiError) {
      throw new ApiError(error.status, error.message, error.body);
    }
    throw error;
  }
}

export const getTerminals = (taskId: string, signal?: AbortSignal) =>
  terminalCall(
    () => terminalsApi().terminalsList({ taskId }, { signal }),
  ) as Promise<PersistedTerminalSession[]>;
export const listResumableTerminals = (
  taskId?: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
) =>
  terminalCall(() =>
    terminalsApi().terminalsResumableList(
      { taskId, projectId, moduleId },
      { signal },
    ),
  ) as Promise<ResumableTerminalSession[]>;
export const getScratchTerminals = (
  projectId: string,
  moduleId?: string,
  signal?: AbortSignal,
) =>
  terminalCall(() =>
    terminalsApi().terminalsScratchList(
      { projectId, moduleId },
      { signal },
    ),
  ) as Promise<PersistedTerminalSession[]>;
export const terminateTerminal = (agentRunId: string) =>
  terminalCall(() => terminalsApi().terminalsDestroy({ agentRunId }));
export const resumeTerminal = (agentRunId: string) =>
  terminalCall(() => terminalsApi().terminalsResumeCreate({ agentRunId }));
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
  terminalCall(() => terminalsApi().terminalsCreate({ createTerminal: body }));

export const getDocuments = (
  taskId: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
) =>
  documentsApi().documentsRetrieve(
    { taskId, projectId, moduleId },
    { signal },
  ) as Promise<{ documents: DesignDoc[] }>;
export const getScratchDocuments = (moduleId: string, signal?: AbortSignal) =>
  documentsApi().documentsRetrieve(
    { scope: "scratch", moduleId },
    { signal },
  ) as Promise<{ documents: DesignDoc[] }>;
export const fsComplete = (path: string, signal?: AbortSignal) =>
  documentsApi().fsCompleteRetrieve({ path }, { signal });
