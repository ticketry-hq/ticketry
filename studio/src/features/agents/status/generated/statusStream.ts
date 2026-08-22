// Generated from operations/statusStream.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { AutomationAttemptPayload } from "./attempts";

export interface RunHoldingPayload {
  readonly agent_run_id: string;
  readonly project_id: string;
  readonly task_id: string | null;
  readonly module_id: string;
  readonly agent: string | null;
  readonly scope: string;
  readonly launch_state: string | null;
  readonly launch_model: string | null;
  readonly started_at: string;
  readonly state: string;
  readonly effective_state: string;
  readonly updated_at: string;
  readonly provider_session_id: string | null;
  readonly output_sequence: number;
  readonly last_output_at: string | null;
}

export interface RunStatusSnapshotFrame {
  readonly __typename: "RunStatusSnapshot";
  readonly project_id: string;
  readonly cursor: number;
  readonly at: string;
  readonly runs: ReadonlyArray<RunHoldingPayload>;
  readonly automation_attempts: ReadonlyArray<AutomationAttemptPayload>;
}

export interface RunStatusEventFrame {
  readonly __typename: "RunStatusEvent";
  readonly cursor: number;
  readonly event_id: string;
  readonly project_id: string;
  readonly event_kind: string;
  readonly payload_version: number;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly agent_run_id: string | null;
  readonly automation_attempt_id: string | null;
  readonly work_item_id: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly committed_at: string;
}

export interface RunStatusCaughtUpFrame {
  readonly __typename: "RunStatusCaughtUp";
  readonly project_id: string;
  readonly cursor: number;
}

export interface RunStatusResetRequiredFrame {
  readonly __typename: "RunStatusResetRequired";
  readonly project_id: string;
  readonly cursor: number;
  readonly reason: string;
}

export interface RunStatusFailedFrame {
  readonly __typename: "RunStatusFailed";
  readonly code: string;
  readonly message: string;
}

export type RunStatusFrame =
  | RunStatusSnapshotFrame
  | RunStatusEventFrame
  | RunStatusCaughtUpFrame
  | RunStatusResetRequiredFrame
  | RunStatusFailedFrame;

export interface RunStatusStreamVariables {
  readonly projectId: string;
  readonly afterCursor?: number | null;
}
export interface RunStatusStreamSubscription {
  readonly run_status_stream: RunStatusFrame;
}

const source = "subscription RunStatusStream($projectId: String!, $afterCursor: Int) {\n  run_status_stream(project_id: $projectId, after_cursor: $afterCursor) {\n    __typename\n    ... on RunStatusSnapshot {\n      project_id\n      cursor\n      at\n      runs {\n        agent_run_id\n        project_id\n        task_id\n        module_id\n        agent\n        scope\n        launch_state\n        launch_model\n        started_at\n        state\n        effective_state\n        updated_at\n        provider_session_id\n        output_sequence\n        last_output_at\n      }\n      automation_attempts {\n        attempt_id\n        root_attempt_id\n        retry_of_attempt_id\n        work_item_id\n        status\n        error\n        failure\n        retryable\n        agent_run_id\n        updated_at\n      }\n    }\n    ... on RunStatusEvent {\n      cursor\n      event_id\n      project_id\n      event_kind\n      payload_version\n      subject_kind\n      subject_id\n      agent_run_id\n      automation_attempt_id\n      work_item_id\n      payload\n      committed_at\n    }\n    ... on RunStatusCaughtUp {\n      project_id\n      cursor\n    }\n    ... on RunStatusResetRequired {\n      project_id\n      cursor\n      reason\n    }\n    ... on RunStatusFailed {\n      code\n      message\n    }\n  }\n}";
export const RunStatusStreamDocument: TypedDocumentNode<
  RunStatusStreamSubscription, RunStatusStreamVariables
> = { kind: "Document", operationName: "RunStatusStream", source };
