import type { FetchAPI } from "./generated/index.js";
import type { State } from "./generated/models/State.js";
import { createWorkTrackerClient } from "./client.js";

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

export type AgentRunScope = "task" | "plan" | "instant" | "docchat";

export interface RunRecord {
  agent_run_id: string;
  project_id?: string;
  task_id: string | null;
  module_id: string;
  agent?: string;
  scope: AgentRunScope;
  started_at?: string;
  state: RawLifecycleState;
  updated_at: string;
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

export interface BackendSessionFrame {
  v: 1;
  type: "backend_session";
  agent_run_id: string;
  status: "exited" | "lost";
  at: string;
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

export interface LaunchedAgent {
  target_id: string;
  agent: string;
  agent_run_id: string;
}

export interface LaunchAgentRequest {
  issueId: string;
}

export interface AgentStatusClient {
  getAgentStatus(request: GetAgentStatusRequest): Promise<AgentStatusSnapshot>;
  launchAgent(request: LaunchAgentRequest): Promise<LaunchedAgent>;
  retryAutomationAttempt(request: {
    attemptId: string;
  }): Promise<AutomationAttemptRecord>;
}

export function createAgentStatusClient(
  options: AgentStatusClientOptions,
): AgentStatusClient {
  const client = createWorkTrackerClient(options);

  return {
    async getAgentStatus({ projectId, taskId, signal }) {
      return (await client.runs.runsAgentStatusRetrieve(
        { projectId, taskId },
        signal ? { signal } : undefined,
      )) as AgentStatusSnapshot;
    },
    async launchAgent({ issueId }) {
      return (await client.execution.workItemsLaunchAgentCreate({
        issueId,
        agentOverride: {},
      })) as LaunchedAgent;
    },
    async retryAutomationAttempt({ attemptId }) {
      return (await client.runs.automationAttemptsRetryCreate({
        attemptId,
      })) as AutomationAttemptRecord;
    },
  };
}
