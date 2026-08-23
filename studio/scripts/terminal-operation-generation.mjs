import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateTerminalOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "agentTerminalSessions(filters: AgentTerminalSessionsFilterInput, having: AgentTerminalSessionsHavingInput, orderBy: AgentTerminalSessionsOrderInput, pagination: PaginationInput): AgentTerminalSessionsConnection!",
    "agentRun: AgentRuns",
    "resumable_terminal_sessions(task_id: String, project_id: String, module_id: String): [AgentRuns!]!",
    "create_viewer_lease(agent_run_id: String!, viewer_id: String!, transport: String!): AgentRunViewerLeases!",
    "update_viewer_lease(agent_run_id: String!, viewer_id: String!, generation: String!): AgentRunViewerLeases!",
    "delete_viewer_lease(agent_run_id: String!, viewer_id: String!, generation: String!): AgentRunViewerLeases",
    "terminal_output_observe(agent_run_id: String!): TerminalOutputObservation!",
    "terminal_session_create(client_request_id: String!, project_id: String, issue_id: String, module_id: String!, target_id: String, kind: String!, provider: String, working_directory_identity: String, columns: Int!, rows: Int!",
    "terminal_session_update(agent_run_id: String!, termination_request_id: String): AgentTerminalSessions!",
    "launchState: String",
    "launchModel: String",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Terminal Session schema is missing ${required}`);
    }
  }
  for (const forbidden of [
    "tmuxSessionName",
    "runtimeNamespace",
    "runtimeCleanupPending",
    "outputIdentity",
    "cwd:",
    "designDir",
    "terminalLaunchMaterial",
    "terminalCleanupEffects",
    "agentTerminalSessionsCreate",
    "agentRunViewerLeasesCreate",
    "agentRunViewerLeasesUpdate",
    "agentRunViewerLeasesDelete",
  ]) {
    if (schema.includes(forbidden)) {
      throw new Error(`Terminal Session schema exposes protected field ${forbidden}`);
    }
  }

  const source = (
    await readFile(
      join(sourceRoot, "features/agents/terminal/operations/terminalSessions.graphql"),
      "utf8",
    )
  ).trim();
  const target = join(outputRoot, "terminals");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "terminalSessions.ts"),
    `// Generated from operations/terminalSessions.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface TerminalSessionPayload {
  readonly agent_run_id: string;
  readonly module_id: string;
  readonly scope: "task" | "plan" | "instant" | "docchat" | "shell";
  readonly doc_rel_path: string | null;
  readonly created_at: string;
  readonly agent_run: {
    readonly id: string;
    readonly launch_state: string | null;
    readonly launch_model: string | null;
  } | null;
}

export interface ResumableTerminalSessionPayload {
  readonly agent_run_id: string;
  readonly agent: "claude" | "agy" | "codex" | "gemini";
  readonly status: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly launch_state: string | null;
  readonly launch_model: string | null;
  readonly provider_session_id: string | null;
  readonly resumed_from: string | null;
  readonly scope: "task" | "plan" | "instant";
}

export interface TaskTerminalSessionsVariables {
  readonly taskId: string;
  readonly limit: number;
}
export interface ScratchTerminalSessionsVariables {
  readonly projectId: string;
  readonly moduleId: string;
  readonly limit: number;
}
export interface ModuleShellSessionsVariables {
  readonly moduleId: string;
  readonly limit: number;
}
export interface TerminalSessionsQuery {
  readonly terminal_sessions: {
    readonly sessions: ReadonlyArray<TerminalSessionPayload>;
  };
}
export interface TaskResumableTerminalSessionsVariables {
  readonly taskId: string;
}
export interface ScratchResumableTerminalSessionsVariables {
  readonly projectId: string;
  readonly moduleId: string;
}
export interface ResumableTerminalSessionsQuery {
  readonly resumable_sessions: ReadonlyArray<ResumableTerminalSessionPayload>;
}
export interface CreateTerminalSessionVariables {
  readonly clientRequestId: string;
  readonly projectId: string;
  readonly issueId: string;
  readonly moduleId: string;
  readonly targetId: string;
  readonly kind: "task" | "planning" | "instant" | "document_chat" | "automation";
  readonly provider: string;
  readonly workingDirectoryIdentity: string;
  readonly columns: number;
  readonly rows: number;
  readonly model?: string | null;
  readonly reasoning?: string | null;
  readonly policyReference?: string | null;
  readonly prompt?: string | null;
  readonly resumeFromAgentRunId?: string | null;
  readonly automationAttemptId?: string | null;
  readonly requiredSkills?: ReadonlyArray<string> | null;
  readonly designDirectoryIdentity?: string | null;
  readonly documentRelativePath?: string | null;
}
export interface CreateTerminalSessionMutation {
  readonly terminal_session: TerminalSessionPayload;
}
export interface CreateModuleShellVariables {
  readonly clientRequestId: string;
  readonly moduleId: string;
  readonly columns: number;
  readonly rows: number;
}
export interface ResumeTerminalSessionVariables extends Omit<CreateTerminalSessionVariables,
  "prompt" | "resumeFromAgentRunId" | "automationAttemptId" | "documentRelativePath"
> {
  readonly resumeFromAgentRunId: string;
}
export interface UpdateTerminalSessionVariables {
  readonly agentRunId: string;
  readonly terminationRequestId?: string | null;
}
export interface UpdateTerminalSessionMutation {
  readonly terminal_session: TerminalSessionPayload;
}

const source = ${JSON.stringify(source)};
const document = <TVariables>(operationName: string): TypedDocumentNode<TerminalSessionsQuery, TVariables> => ({
  kind: "Document", operationName, source,
});
export const TaskTerminalSessionsDocument = document<TaskTerminalSessionsVariables>("TaskTerminalSessions");
export const ScratchTerminalSessionsDocument = document<ScratchTerminalSessionsVariables>("ScratchTerminalSessions");
export const ModuleShellSessionsDocument = document<ModuleShellSessionsVariables>("ModuleShellSessions");
const resumableDocument = <TVariables>(operationName: string): TypedDocumentNode<ResumableTerminalSessionsQuery, TVariables> => ({
  kind: "Document", operationName, source,
});
export const TaskResumableTerminalSessionsDocument = resumableDocument<TaskResumableTerminalSessionsVariables>("TaskResumableTerminalSessions");
export const ScratchResumableTerminalSessionsDocument = resumableDocument<ScratchResumableTerminalSessionsVariables>("ScratchResumableTerminalSessions");
export const CreateTerminalSessionDocument = {
  kind: "Document",
  operationName: "CreateTerminalSession",
  source,
} as TypedDocumentNode<CreateTerminalSessionMutation, CreateTerminalSessionVariables>;
export const CreateModuleShellDocument = {
  kind: "Document",
  operationName: "CreateModuleShell",
  source,
} as TypedDocumentNode<CreateTerminalSessionMutation, CreateModuleShellVariables>;
export const ResumeTerminalSessionDocument = {
  kind: "Document",
  operationName: "ResumeTerminalSession",
  source,
} as TypedDocumentNode<CreateTerminalSessionMutation, ResumeTerminalSessionVariables>;
export const UpdateTerminalSessionDocument = {
  kind: "Document",
  operationName: "UpdateTerminalSession",
  source,
} as TypedDocumentNode<UpdateTerminalSessionMutation, UpdateTerminalSessionVariables>;
`,
    "utf8",
  );

  const leaseSource = (
    await readFile(
      join(sourceRoot, "features/agents/terminal/operations/viewerLeases.graphql"),
      "utf8",
    )
  ).trim();
  await writeFile(
    join(target, "viewerLeases.ts"),
    `// Generated from operations/viewerLeases.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface ViewerLeasePayload {
  readonly agent_run_id: string;
  readonly viewer_id: string;
  readonly transport: "native" | "xterm";
  readonly generation: string;
  readonly acquired_at: string;
  readonly expires_at: string;
}

export interface CreateViewerLeaseVariables {
  readonly agentRunId: string;
  readonly viewerId: string;
  readonly transport: "native" | "xterm";
}
export interface OwnedViewerLeaseVariables {
  readonly agentRunId: string;
  readonly viewerId: string;
  readonly generation: string;
}
export interface ViewerLeaseMutation {
  readonly viewer_lease: ViewerLeasePayload;
}
export interface DeleteViewerLeaseMutation {
  readonly viewer_lease: ViewerLeasePayload | null;
}

const source = ${JSON.stringify(leaseSource)};
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document", operationName, source,
});
export const CreateViewerLeaseDocument = document<ViewerLeaseMutation, CreateViewerLeaseVariables>("CreateViewerLease");
export const UpdateViewerLeaseDocument = document<ViewerLeaseMutation, OwnedViewerLeaseVariables>("UpdateViewerLease");
export const DeleteViewerLeaseDocument = document<DeleteViewerLeaseMutation, OwnedViewerLeaseVariables>("DeleteViewerLease");
`,
    "utf8",
  );

  const activitySource = (
    await readFile(
      join(sourceRoot, "features/agents/terminal/operations/outputActivity.graphql"),
      "utf8",
    )
  ).trim();
  await writeFile(
    join(target, "outputActivity.ts"),
    `// Generated from operations/outputActivity.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface TerminalOutputObservationPayload {
  readonly advanced: boolean;
  readonly output_sequence: number;
  readonly last_output_at: string | null;
}

export interface ObserveTerminalOutputVariables {
  readonly agentRunId: string;
}
export interface ObserveTerminalOutputMutation {
  readonly observation: TerminalOutputObservationPayload;
}

export const ObserveTerminalOutputDocument = {
  kind: "Document",
  operationName: "ObserveTerminalOutput",
  source: ${JSON.stringify(activitySource)},
} as TypedDocumentNode<ObserveTerminalOutputMutation, ObserveTerminalOutputVariables>;
`,
    "utf8",
  );
}
