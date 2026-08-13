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
}
