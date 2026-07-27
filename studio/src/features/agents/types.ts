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

export interface Profile {
  name: string;
  workspace_slug: string;
  agent_prompt: string | null;
  agent_prompts: Record<string, string>;
  module_folders: Record<string, string>;
  recent_project_id?: string | null;
  recent_module_ids?: Record<string, string>;
}

export type AgentName = "claude" | "agy" | "codex" | "gemini";
export type TaskId = string;
export type SessionId = string;

export interface ConfigPayload {
  recent_profile_index: number | null;
  profiles: Profile[];
}

export interface PersistedTerminalSession {
  agent_run_id: string;
  tmux_session_name: string;
  task_id: string;
  module_id: string;
  project_id: string;
  agent: AgentName;
  scope: "task" | "plan" | "instant" | "docchat";
  doc_rel_path?: string | null;
  created_at: string;
  terminated_at: string | null;
}

export interface ResumableTerminalSession {
  agent_run_id: string;
  agent: AgentName;
  status: string;
  started_at: string;
  ended_at: string;
  provider_session_id: string | null;
  resumed_from: string | null;
}

export const TEMP_TASK_ID = "__scratch__";
export const SCRATCH_RUN_TASK_ID = "00000000-0000-0000-0000-000000000000";

export interface DesignDoc {
  id: string;
  rel_path: string;
  label: string;
}

export interface DocTabState {
  docId: string;
  relPath: string;
  label: string;
  open: boolean;
  reloadToken: number;
}

export type TabKind = "details" | "doc" | "terminal";

export interface RunChip {
  agentRunId: string | null;
  agent: string;
  label: string;
}
