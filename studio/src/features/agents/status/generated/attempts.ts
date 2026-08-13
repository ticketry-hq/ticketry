// Generated from operations/attempts.graphql. Do not edit manually.

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

const source = "fragment AutomationAttemptFields on AutomationAttemptProjection {\n  attempt_id\n  root_attempt_id\n  retry_of_attempt_id\n  work_item_id\n  status\n  error\n  failure\n  retryable\n  agent_run_id\n  updated_at\n}\n\nquery AutomationAttempts($projectId: String!, $taskId: String) {\n  automation_attempts(project_id: $projectId, task_id: $taskId) {\n    ...AutomationAttemptFields\n  }\n}\n\nmutation RetryAutomationAttempt($attemptId: String!) {\n  retry_automation_attempt(attempt_id: $attemptId) {\n    ...AutomationAttemptFields\n  }\n}\n\nmutation DismissAutomationAttempt($attemptId: String!) {\n  dismiss_automation_attempt(attempt_id: $attemptId) {\n    ...AutomationAttemptFields\n  }\n}";
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
