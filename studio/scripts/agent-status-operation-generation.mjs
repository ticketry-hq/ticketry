import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateAgentStatusOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "automation_attempts(project_id: String!, task_id: String): [AutomationAttemptProjection!]!",
    "retry_automation_attempt(attempt_id: String!): AutomationAttemptProjection!",
    "dismiss_automation_attempt(attempt_id: String!): AutomationAttemptProjection!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Runs schema is missing ${required}`);
    }
  }
  const operationPath = join(
    sourceRoot,
    "features/agents/status/operations/attempts.graphql",
  );
  const source = (await readFile(operationPath, "utf8")).trim();
  const target = join(outputRoot, "agent-status");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "attempts.ts"),
    `// Generated from operations/attempts.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface AutomationAttemptPayload {
  readonly attempt_id: string;
  readonly root_attempt_id: string;
  readonly retry_of_attempt_id: string | null;
  readonly work_item_id: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly error: string | null;
  readonly failure: Readonly<Record<string, unknown>> | null;
  readonly retryable: boolean;
  readonly agent_run_id: string | null;
  readonly updated_at: string;
}

export interface AutomationAttemptsVariables {
  readonly projectId: string;
  readonly taskId?: string | null;
}
export interface AutomationAttemptsQuery {
  readonly automation_attempts: ReadonlyArray<AutomationAttemptPayload>;
}
export interface AttemptMutationVariables { readonly attemptId: string; }

const source = ${JSON.stringify(source)};
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document", operationName, source,
});
export const AutomationAttemptsDocument = document<
  AutomationAttemptsQuery, AutomationAttemptsVariables
>("AutomationAttempts");
export const RetryAutomationAttemptDocument = document<
  { readonly retry_automation_attempt: AutomationAttemptPayload }, AttemptMutationVariables
>("RetryAutomationAttempt");
export const DismissAutomationAttemptDocument = document<
  { readonly dismiss_automation_attempt: AutomationAttemptPayload }, AttemptMutationVariables
>("DismissAutomationAttempt");
`,
    "utf8",
  );
  await writeFile(
    join(target, "statusStream.ts"),
    await statusStreamModule({ schema, sourceRoot }),
    "utf8",
  );
}

/// The status stream is a typed receive-only union, so its generated module
/// mirrors every member the schema declares. A missing member fails generation
/// rather than producing a client that silently drops a frame.
async function statusStreamModule({ schema, sourceRoot }) {
  for (const required of [
    "run_status_stream(project_id: String!, after_cursor: Int): RunStatusFrame!",
    "union RunStatusFrame = RunStatusSnapshot | RunStatusEvent | RunStatusCaughtUp | RunStatusResetRequired | RunStatusFailed",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Runs status stream schema is missing ${required}`);
    }
  }
  const source = (
    await readFile(
      join(sourceRoot, "features/agents/status/operations/statusStream.graphql"),
      "utf8",
    )
  ).trim();
  return `// Generated from operations/statusStream.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";
import type { AutomationAttemptPayload } from "./attempts";

export interface RunHoldingPayload {
  readonly agent_run_id: string;
  readonly project_id: string;
  readonly task_id: string | null;
  readonly module_id: string;
  readonly agent: string;
  readonly scope: string;
  readonly started_at: string;
  readonly state: string;
  readonly updated_at: string;
  readonly provider_session_id: string | null;
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

const source = ${JSON.stringify(source)};
export const RunStatusStreamDocument: TypedDocumentNode<
  RunStatusStreamSubscription, RunStatusStreamVariables
> = { kind: "Document", operationName: "RunStatusStream", source };
`;
}
