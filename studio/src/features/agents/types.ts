export type LifecycleState =
  | "starting"
  | "working"
  | "needs_input"
  | "permission_required"
  | "turn_complete"
  | "quiet"
  | "reconnecting"
  | "exited"
  | "lost"
  | "error"
  | "unknown";

export type { Profile } from "../studio/lib/types";

export type AgentName = "claude" | "agy" | "codex" | "gemini";
export type TaskId = string;
export type SessionId = string;

export interface PersistedTerminalSession {
  agent_run_id: string;
  tmux_session_name: string;
  doc_rel_path?: string | null;
  created_at: string;
}

export const TEMP_TASK_ID = "__scratch__";
export const SCRATCH_RUN_TASK_ID = "00000000-0000-0000-0000-000000000000";

export interface DesignDoc {
  id: string;
  rel_path: string;
  label: string;
}

export type TabKind = "details" | "doc" | "terminal";
