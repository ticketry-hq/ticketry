import type { AutomationAttemptFieldsFragment } from "./generated/attempts.documents";
import type { RunStatusStreamSubscription } from "./generated/statusStream.documents";

export type AutomationAttemptPayload = AutomationAttemptFieldsFragment;

type GeneratedRunStatusFrame = RunStatusStreamSubscription["run_status_stream"];

export type RunStatusSnapshotFrame = Extract<
  GeneratedRunStatusFrame,
  { __typename: "RunStatusSnapshot" }
>;
type GeneratedRunStatusEventFrame = Extract<
  GeneratedRunStatusFrame,
  { __typename: "RunStatusEvent" }
>;
export type RunStatusEventFrame = Omit<GeneratedRunStatusEventFrame, "payload"> & {
  readonly payload: Readonly<Record<string, unknown>>;
};
export type RunStatusCaughtUpFrame = Extract<
  GeneratedRunStatusFrame,
  { __typename: "RunStatusCaughtUp" }
>;
export type RunStatusResetRequiredFrame = Extract<
  GeneratedRunStatusFrame,
  { __typename: "RunStatusResetRequired" }
>;
export type RunStatusFailedFrame = Extract<
  GeneratedRunStatusFrame,
  { __typename: "RunStatusFailed" }
>;
export type RunStatusFrame =
  | RunStatusSnapshotFrame
  | RunStatusEventFrame
  | RunStatusCaughtUpFrame
  | RunStatusResetRequiredFrame
  | RunStatusFailedFrame;
export type RunHoldingPayload = RunStatusSnapshotFrame["runs"][number];

export type RawLifecycleState =
  | "starting" | "working" | "needs_input" | "permission_required"
  | "turn_complete" | "quiet" | "reconnecting" | "exited" | "lost"
  | "error" | "unknown";
export type RunPresentationState = RawLifecycleState | "stalled";
export type AgentRunScope = "task" | "plan" | "instant" | "docchat" | "shell";
export interface RunRecord {
  agent_run_id: string;
  project_id?: string;
  task_id: string | null;
  module_id: string;
  agent?: string | null;
  scope: AgentRunScope;
  launch_state?: string | null;
  launch_model?: string | null;
  started_at?: string;
  state: RawLifecycleState;
  updated_at: string;
  exit_code?: number | null;
  output_sequence?: number;
  last_output_at?: string | null;
  effective_state?: RunPresentationState;
}
export interface AgentStatusScope { project_id: string; task_id: string | null }
export interface AutomationAttemptRecord {
  attempt_id: string;
  root_attempt_id: string;
  retry_of_attempt_id: string | null;
  work_item_id: string;
  status: "pending" | "succeeded" | "failed";
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

export type AgentLifecycle = "idle" | "active" | "attention";

export interface AgentStatusData {
  projectId: string | null;
  runs: Record<string, RunRecord>;
  automationAttempts: Record<string, AutomationAttemptRecord>;
  automationByTask: Record<string, string[]>;
  /**
   * Bumped when only the clock has moved a run past its unchanged-output
   * deadline. Readers project from `runs` plus the current time, so this is
   * what tells them to reproject without any run fact having changed.
   */
  stallEpoch: number;
}
