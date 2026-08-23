import { studioRuntime } from "../../../../runtime";
import type {
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../../types";
import {
  ScratchResumableTerminalSessionsDocument,
  ScratchTerminalSessionsDocument,
  TaskResumableTerminalSessionsDocument,
  TaskTerminalSessionsDocument,
  type ResumableTerminalSessionPayload,
  type TerminalSessionPayload,
} from "../generated/terminalSessions";

const PAGE_LIMIT = 500;

/**
 * Terminal sessions are read from the Rust Terminal Session graph over the
 * in-process GraphQL transport. The `/api/terminals` reads browser development
 * used were retired with the Python terminal authority, so a platform without
 * that transport has no session list rather than an empty one.
 */
function adaptSession(payload: TerminalSessionPayload): PersistedTerminalSession | null {
  if (payload.agent_run?.id !== payload.agent_run_id) return null;
  return {
    agent_run_id: payload.agent_run_id,
    doc_rel_path: payload.doc_rel_path,
    created_at: payload.created_at,
    launch_state: payload.agent_run.launch_state,
    launch_model: payload.agent_run.launch_model,
  };
}

function adaptSessions(payloads: readonly TerminalSessionPayload[]): PersistedTerminalSession[] {
  return payloads.flatMap((payload) => {
    const session = adaptSession(payload);
    return session ? [session] : [];
  });
}

function adaptResumableSessions(
  payloads: readonly ResumableTerminalSessionPayload[],
): ResumableTerminalSession[] {
  return payloads.map((payload) => ({ ...payload }));
}

export function readTaskTerminalSessions(
  taskId: string,
): Promise<PersistedTerminalSession[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => adaptSessions(
      (await execute(TaskTerminalSessionsDocument, { taskId, limit: PAGE_LIMIT }))
        .terminal_sessions.sessions,
    ),
  });
}

export function readScratchTerminalSessions(
  projectId: string,
  moduleId: string,
): Promise<PersistedTerminalSession[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => adaptSessions(
      (await execute(ScratchTerminalSessionsDocument, {
        projectId,
        moduleId,
        limit: PAGE_LIMIT,
      })).terminal_sessions.sessions,
    ),
  });
}

export function readTaskResumableTerminalSessions(
  taskId: string,
): Promise<ResumableTerminalSession[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => adaptResumableSessions(
      (await execute(TaskResumableTerminalSessionsDocument, { taskId }))
        .resumable_sessions,
    ),
  });
}

export function readScratchResumableTerminalSessions(
  projectId: string,
  moduleId: string,
): Promise<ResumableTerminalSession[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => adaptResumableSessions(
      (await execute(ScratchResumableTerminalSessionsDocument, {
        projectId,
        moduleId,
      })).resumable_sessions,
    ),
  });
}
