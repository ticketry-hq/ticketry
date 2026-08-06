import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import * as api from "../api/agentApi";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

const EMPTY_PERSISTED_INDEX: Record<string, PersistedTerminalSession[]> = {};
const EMPTY_RESUMABLE_INDEX: Record<string, ResumableTerminalSession[]> = {};

export async function loadPersistedTerminalSessions(
  taskId: string,
): Promise<PersistedTerminalSession[]> {
  const queryKey = queryKeys.terminalSessions.persisted(taskId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) => api.getTerminals(taskId, signal),
    staleTime: 0,
  });
}

export async function loadScratchTerminalSessions(
  projectId: string,
  moduleId?: string,
): Promise<PersistedTerminalSession[]> {
  const queryKey = queryKeys.terminalSessions.scratch(projectId, moduleId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) =>
      moduleId
        ? api.getScratchTerminals(projectId, moduleId, signal)
        : api.getScratchTerminals(projectId, undefined, signal),
    staleTime: 0,
  });
}

export async function loadResumableTerminalSessions(
  taskId?: string,
  projectId?: string,
  moduleId?: string,
): Promise<ResumableTerminalSession[]> {
  const queryKey = queryKeys.terminalSessions.resumable(
    taskId,
    projectId,
    moduleId,
  );
  await queryClient.cancelQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) =>
      taskId
        ? api.listResumableTerminals(taskId, undefined, undefined, signal)
        : api.listResumableTerminals(undefined, projectId, moduleId, signal),
    staleTime: 0,
  });
}

export function getPersistedTerminalSessionIndex(): Record<
  string,
  PersistedTerminalSession[]
> {
  return (
    queryClient.getQueryData(queryKeys.terminalSessions.persistedIndex) ??
    EMPTY_PERSISTED_INDEX
  );
}

export function setPersistedTerminalSessionIndex(
  sessions: Record<string, PersistedTerminalSession[]>,
): void {
  queryClient.setQueryData(queryKeys.terminalSessions.persistedIndex, sessions);
}

export function getResumableTerminalSessionIndex(): Record<
  string,
  ResumableTerminalSession[]
> {
  return (
    queryClient.getQueryData(queryKeys.terminalSessions.resumableIndex) ??
    EMPTY_RESUMABLE_INDEX
  );
}

export function setResumableTerminalSessionIndex(
  sessions: Record<string, ResumableTerminalSession[]>,
): void {
  queryClient.setQueryData(queryKeys.terminalSessions.resumableIndex, sessions);
}
