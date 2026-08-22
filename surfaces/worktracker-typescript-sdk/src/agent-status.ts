import type { FetchAPI } from "./generated/index.js";
import type { State } from "./generated/models/State.js";
import { createAuthenticatedFetch } from "./client.js";

export type RawLifecycleState =
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

/**
 * The render-facing vocabulary. `stalled` is the effective presentation of a
 * still-live run whose terminal output has not changed for the inactivity
 * threshold; it is never a provider lifecycle event kind and is never
 * persisted as a run's lifecycle state.
 */
export type RunPresentationState = RawLifecycleState | "stalled";

/**
 * A run's durable routing discriminator. `shell` is the one scope whose runs
 * have no provider at all — a shell run's `agent` is null.
 */
export type AgentRunScope = "task" | "plan" | "instant" | "docchat" | "shell";

/**
 * Two independently ordered axes for one durable run: the provider lifecycle
 * (`state`/`updated_at`, ordered by lifecycle timestamp) and terminal output
 * activity (`output_sequence`/`last_output_at`, ordered by the monotonic
 * per-session sequence). Neither timestamp decides the other axis's validity.
 */
export interface RunRecord {
  agent_run_id: string;
  project_id?: string;
  task_id: string | null;
  module_id: string;
  /** The provider slug, or `null` on a run that has no provider (`shell`). */
  agent?: string | null;
  scope: AgentRunScope;
  /**
   * The display name of the workflow state this run was launched in, captured
   * once at spawn. `null` on a run that recorded none — a run predating the
   * snapshot, or a scope with no workflow state. Never substitute the work
   * item's current state for it.
   */
  launch_state?: string | null;
  /** The model this run's launch configuration actually resolved, or `null`. */
  launch_model?: string | null;
  started_at?: string;
  state: RawLifecycleState;
  updated_at: string;
  /**
   * The hosted command's own result, once one has been observed. Null while the
   * run is live, and null on an ending that recorded no mechanical code (an
   * explicit termination, a missing runtime).
   */
  exit_code?: number | null;
  /** Monotonic per-session count of *changed* terminal output observations. */
  output_sequence?: number;
  /**
   * Backend-owned stamp of the newest changed output, or the session's
   * creation time until real output is observed.
   */
  last_output_at?: string | null;
  /** The backend's read-time projection of both axes. */
  effective_state?: RunPresentationState;
}

export interface AgentStatusScope {
  project_id: string;
  task_id: string | null;
}

export interface AgentStatusSnapshot {
  scope: AgentStatusScope;
  runs: RunRecord[];
  automation_attempts: AutomationAttemptRecord[];
  at: string;
}

export type AutomationAttemptStatus = "pending" | "succeeded" | "failed";

export interface AutomationAttemptRecord {
  attempt_id: string;
  root_attempt_id: string;
  retry_of_attempt_id: string | null;
  work_item_id: string;
  status: AutomationAttemptStatus;
  error: string | null;
  failure: {
    code: string;
    provider: string;
    skill: string;
    reason: string;
    detail: string;
    remediation: string;
    retryable: boolean;
  } | null;
  retryable: boolean;
  agent_run_id: string | null;
  updated_at: string;
}

export interface AutomationAttemptFrame {
  v: 1;
  type: "automation_attempt";
  project_id: string;
  attempt: AutomationAttemptRecord;
}

export interface StatusSnapshotFrame extends AgentStatusSnapshot {
  v: 1;
  type: "snapshot";
  /** Present on socket snapshots; omitted by synthetic HTTP snapshots. */
  work_item_cursor?: number;
  /** Present on socket snapshots so reconnect repairs catalog metadata. */
  workflow_states?: WorkItemState[];
}

export interface AgentLifecycleFrame {
  v: 1;
  type: "agent_lifecycle";
  at: string;
  run: RunRecord;
}

/**
 * One terminal-output-activity delta. Self-sufficient (it carries the whole
 * run record) and mergeable by `run.output_sequence`, so a reordered delivery
 * cannot rewind the activity axis.
 */
export interface TerminalActivityFrame {
  v: 1;
  type: "terminal_activity";
  at: string;
  run: RunRecord;
}

export interface BackendSessionFrame {
  v: 1;
  type: "backend_session";
  agent_run_id: string;
  status: "exited" | "lost";
  at: string;
  /**
   * The hosted command's exit code when the ending recorded one. A `lost`
   * runtime and an explicit termination both carry `null`.
   */
  exit_code?: number | null;
}

export type WorkItemState = Omit<State, "id" | "group" | "color"> & {
  id: string;
  group: string;
  color: string | null;
};

/** One committed work-item change projection on the project status feed. */
export interface WorkItemStateFrame {
  v: 1;
  type: "work_item_state";
  project_id: string;
  work_item_id: string;
  state: WorkItemState | null;
  revision: number;
  updated_at: string;
  membership_changed?: boolean;
}

/** One authoritative workflow-state catalog row on the project status feed. */
export interface WorkflowStateFrame {
  v: 1;
  type: "workflow_state";
  project_id: string;
  state: WorkItemState;
  updated_at: string;
}

export interface StatusCursorFrame {
  v: 1;
  type: "cursor";
  project_id: string;
  revision: number;
}

export interface StatusDocumentFrame {
  v: 1;
  type: "document";
  at: string;
  task_id: string;
  module_id?: string;
  event?: "created" | "updated";
  doc: {
    id: string;
    rel_path?: string;
    [key: string]: unknown;
  };
}

export type AgentStatusFrame =
  | StatusSnapshotFrame
  | AgentLifecycleFrame
  | TerminalActivityFrame
  | BackendSessionFrame
  | AutomationAttemptFrame
  | WorkItemStateFrame
  | WorkflowStateFrame
  | StatusCursorFrame
  | StatusDocumentFrame;

export interface GetAgentStatusRequest {
  projectId: string;
  taskId?: string;
  signal?: AbortSignal;
}

export interface AgentStatusClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchAPI;
}

export interface AgentStatusClient {
  getAgentStatus(request: GetAgentStatusRequest): Promise<AgentStatusSnapshot>;
  retryAutomationAttempt(request: {
    attemptId: string;
  }): Promise<AutomationAttemptRecord>;
}

export function createAgentStatusClient(
  options: AgentStatusClientOptions,
): AgentStatusClient {
  const fetchApi = createAuthenticatedFetch(options);
  const base = options.baseUrl.replace(/\/+$/, "");
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchApi(`${base}${path}`, init);
    return await response.json() as T;
  };

  return {
    async getAgentStatus({ projectId, taskId, signal }) {
      const query = new URLSearchParams({ project_id: projectId });
      if (taskId) query.set("task_id", taskId);
      return json<AgentStatusSnapshot>(`/runs/agent-status?${query}`, { signal });
    },
    async retryAutomationAttempt({ attemptId }) {
      return json<AutomationAttemptRecord>(
        `/automation-attempts/${encodeURIComponent(attemptId)}/retry`,
        { method: "POST" },
      );
    },
  };
}
