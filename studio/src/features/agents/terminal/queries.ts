import { useQuery } from "@tanstack/react-query";
import type { PersistedTerminalSession } from "../types";
import * as api from "../api/agentApi";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

const EMPTY_SESSIONS: PersistedTerminalSession[] = [];

/** The one immutable holding for a task's durable terminal-session rows. */
export function usePersistedTerminalSessions(
  taskId: string | null,
): { sessions: PersistedTerminalSession[]; isFetched: boolean } {
  const query = useQuery(
    {
      queryKey: taskId
        ? queryKeys.terminalSessions.persisted(taskId)
        : queryKeys.terminalSessions.persisted("none"),
      queryFn: ({ signal }) => api.getTerminals(taskId!, signal),
      enabled: taskId !== null,
      staleTime: 0,
    },
    queryClient,
  );
  return { sessions: query.data ?? EMPTY_SESSIONS, isFetched: query.isFetched };
}

/** The one immutable holding for a module scratch workspace's sessions. */
export function useScratchTerminalSessions(
  projectId: string | null,
  moduleId: string | null,
): { sessions: PersistedTerminalSession[]; isFetched: boolean } {
  const query = useQuery(
    {
      queryKey:
        projectId && moduleId
          ? queryKeys.terminalSessions.scratch(projectId, moduleId)
          : queryKeys.terminalSessions.scratch("none", null),
      queryFn: ({ signal }) =>
        api.getScratchTerminals(projectId!, moduleId!, signal),
      enabled: projectId !== null && moduleId !== null,
      staleTime: 0,
    },
    queryClient,
  );
  return { sessions: query.data ?? EMPTY_SESSIONS, isFetched: query.isFetched };
}
