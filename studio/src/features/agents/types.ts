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
  doc_rel_path?: string | null;
  created_at: string;
  launch_state?: string | null;
  launch_model?: string | null;
}

export interface ResumableTerminalSession {
  agent_run_id: string;
  agent: AgentName;
  status: string;
  started_at: string;
  ended_at?: string | null;
  /**
   * The launch snapshot the durable run captured (#693), carried on the dormant
   * listing so a resume chip reads the phase its conversation began in even
   * when the run has aged out of the status snapshot (#695).
   */
  launch_state?: string | null;
  launch_model?: string | null;
  provider_session_id: string | null;
  resumed_from: string | null;
  scope?: "task" | "plan" | "instant";
}

export const TEMP_TASK_ID = "__scratch__";
export const SCRATCH_RUN_TASK_ID = "00000000-0000-0000-0000-000000000000";

/** Design documents are owned by the Documents feature; re-exported here so
 * existing agent-workspace consumers keep one import site. */
export type { DesignDoc } from "../documents/types";

export type TabKind = "details" | "doc" | "terminal";
