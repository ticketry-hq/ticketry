import type {
  AgentName,
  PersistedTerminalSession,
  ResumableTerminalSession,
} from "../../types";
import type {
  ResumableTerminalSessionFieldsFragment as ResumableTerminalSessionPayload,
  TerminalSessionFieldsFragment as TerminalSessionPayload,
} from "../generated/terminalSessions.documents";

export const TERMINAL_SESSION_PAGE_LIMIT = 500;

function isAgentName(value: string | null): value is AgentName {
  return value === "claude" || value === "agy" || value === "codex" || value === "gemini";
}

function isResumableScope(
  value: string,
): value is ResumableTerminalSession["scope"] & string {
  return value === "task" || value === "plan" || value === "instant";
}

function adaptSession(
  payload: TerminalSessionPayload,
): PersistedTerminalSession | null {
  if (payload.agent_run?.id !== payload.agent_run_id) return null;
  return {
    agent_run_id: payload.agent_run_id,
    doc_rel_path: payload.doc_rel_path,
    created_at: payload.created_at,
    launch_state: payload.agent_run.launch_state,
    launch_model: payload.agent_run.launch_model,
  };
}

export function adaptTerminalSessions(
  payloads: readonly TerminalSessionPayload[],
): PersistedTerminalSession[] {
  return payloads.flatMap((payload) => {
    const session = adaptSession(payload);
    return session ? [session] : [];
  });
}

export function adaptResumableTerminalSessions(
  payloads: readonly ResumableTerminalSessionPayload[],
): ResumableTerminalSession[] {
  return payloads.flatMap((payload) => {
    if (!isAgentName(payload.agent) || !isResumableScope(payload.scope)) return [];
    return [{
      agent_run_id: payload.agent_run_id,
      agent: payload.agent,
      status: payload.status,
      started_at: payload.started_at,
      ended_at: payload.ended_at,
      launch_state: payload.launch_state,
      launch_model: payload.launch_model,
      provider_session_id: payload.provider_session_id,
      resumed_from: payload.resumed_from,
      scope: payload.scope,
    }];
  });
}
