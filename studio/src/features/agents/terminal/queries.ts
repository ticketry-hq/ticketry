import { useQuery } from "@tanstack/react-query";
import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import {
  readScratchResumableTerminalSessions,
  readScratchTerminalSessions,
  readTaskResumableTerminalSessions,
  readTaskTerminalSessions,
} from "./internal/sessionReadTransport";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

const EMPTY_SESSIONS: PersistedTerminalSession[] = [];
const EMPTY_RESUMABLE_SESSIONS: ResumableTerminalSession[] = [];

/** The one immutable holding for a task's durable terminal-session rows. */
export function usePersistedTerminalSessions(
  taskId: string | null,
): { sessions: PersistedTerminalSession[]; isFetched: boolean } {
  const query = useQuery(
    {
      queryKey: taskId
        ? queryKeys.terminalSessions.persisted(taskId)
        : queryKeys.terminalSessions.persisted("none"),
      queryFn: ({ signal }) => readTaskTerminalSessions(taskId!, signal),
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
        readScratchTerminalSessions(projectId!, moduleId!, signal),
      enabled: projectId !== null && moduleId !== null,
      staleTime: 0,
    },
    queryClient,
  );
  return { sessions: query.data ?? EMPTY_SESSIONS, isFetched: query.isFetched };
}

/** Ended provider sessions that can be resumed into a new terminal run. */
export function useResumableTerminalSessions(
  taskId: string | null,
  projectId: string | null,
  moduleId: string | null,
): ResumableTerminalSession[] {
  const enabled = taskId !== null || (projectId !== null && moduleId !== null);
  const query = useQuery(
    {
      queryKey: queryKeys.terminalSessions.resumable(
        taskId,
        taskId ? null : projectId,
        taskId ? null : moduleId,
      ),
      queryFn: ({ signal }) =>
        taskId
          ? readTaskResumableTerminalSessions(taskId, signal)
          : readScratchResumableTerminalSessions(projectId!, moduleId!, signal),
      enabled,
      staleTime: 0,
    },
    queryClient,
  );
  return query.data ?? EMPTY_RESUMABLE_SESSIONS;
}
