import { useQuery } from "@apollo/client/react";
import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../types";
import {
  adaptResumableTerminalSessions,
  adaptTerminalSessions,
  TERMINAL_SESSION_PAGE_LIMIT,
} from "./internal/sessionReadModel";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  ScratchResumableTerminalSessionsDocument,
  ScratchTerminalSessionsDocument,
  TaskResumableTerminalSessionsDocument,
  TaskTerminalSessionsDocument,
} from "./generated/terminalSessions.documents";

const EMPTY_SESSIONS: PersistedTerminalSession[] = [];
const EMPTY_RESUMABLE_SESSIONS: ResumableTerminalSession[] = [];

/** The one immutable holding for a task's durable terminal-session rows. */
export function usePersistedTerminalSessions(
  taskId: string | null,
): { sessions: PersistedTerminalSession[]; isFetched: boolean } {
  const query = useQuery(
    TaskTerminalSessionsDocument,
    {
      client: studioApolloClient(),
      variables: { taskId: taskId ?? "", limit: TERMINAL_SESSION_PAGE_LIMIT },
      skip: !taskId,
    },
  );
  return {
    sessions: query.data
      ? adaptTerminalSessions(query.data.terminal_sessions.sessions)
      : EMPTY_SESSIONS,
    isFetched: query.data !== undefined || query.error !== undefined,
  };
}

/** The one immutable holding for a module scratch workspace's sessions. */
export function useScratchTerminalSessions(
  projectId: string | null,
  moduleId: string | null,
): { sessions: PersistedTerminalSession[]; isFetched: boolean } {
  const query = useQuery(
    ScratchTerminalSessionsDocument,
    {
      client: studioApolloClient(),
      variables: {
        projectId: projectId ?? "",
        moduleId: moduleId ?? "",
        limit: TERMINAL_SESSION_PAGE_LIMIT,
      },
      skip: !projectId || !moduleId,
    },
  );
  return {
    sessions: query.data
      ? adaptTerminalSessions(query.data.terminal_sessions.sessions)
      : EMPTY_SESSIONS,
    isFetched: query.data !== undefined || query.error !== undefined,
  };
}

/** Ended provider sessions that can be resumed into a new terminal run. */
export function useResumableTerminalSessions(
  taskId: string | null,
  projectId: string | null,
  moduleId: string | null,
): ResumableTerminalSession[] {
  const taskQuery = useQuery(
    TaskResumableTerminalSessionsDocument,
    {
      client: studioApolloClient(),
      variables: { taskId: taskId ?? "" },
      skip: !taskId,
    },
  );
  const scratchQuery = useQuery(
    ScratchResumableTerminalSessionsDocument,
    {
      client: studioApolloClient(),
      variables: { projectId: projectId ?? "", moduleId: moduleId ?? "" },
      skip: Boolean(taskId) || !projectId || !moduleId,
    },
  );
  const data = taskQuery.data?.resumable_sessions
    ?? scratchQuery.data?.resumable_sessions;
  return data
    ? adaptResumableTerminalSessions(data)
    : EMPTY_RESUMABLE_SESSIONS;
}
