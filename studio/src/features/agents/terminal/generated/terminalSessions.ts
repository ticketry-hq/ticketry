// Generated from operations/terminalSessions.graphql. Do not edit manually.

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

const source = "fragment TerminalSessionFields on AgentTerminalSessions {\n  agent_run_id: agentRunId\n  module_id: moduleId\n  scope\n  doc_rel_path: docRelPath\n  created_at: createdAt\n  agent_run: agentRun {\n    id\n    launch_state: launchState\n    launch_model: launchModel\n  }\n}\n\nquery ModuleShellSessions($moduleId: String!, $limit: Int!) {\n  terminal_sessions: agentTerminalSessions(\n    filters: {\n      moduleId: { eq: $moduleId }\n      scope: { eq: \"shell\" }\n      terminatedAt: { is_null: true }\n    }\n    orderBy: { createdAt: ASC, agentRunId: ASC }\n    pagination: { offset: { limit: $limit, offset: 0 } }\n  ) {\n    sessions: nodes {\n      ...TerminalSessionFields\n    }\n  }\n}\n\nfragment ResumableTerminalSessionFields on AgentRuns {\n  agent_run_id: id\n  agent\n  status\n  started_at: startedAt\n  ended_at: endedAt\n  launch_state: launchState\n  launch_model: launchModel\n  provider_session_id: providerSessionId\n  resumed_from: resumedFrom\n  scope\n}\n\nquery TaskTerminalSessions($taskId: String!, $limit: Int!) {\n  terminal_sessions: agentTerminalSessions(\n    filters: {\n      taskId: { eq: $taskId }\n      terminatedAt: { is_null: true }\n    }\n    orderBy: { createdAt: DESC, agentRunId: ASC }\n    pagination: { offset: { limit: $limit, offset: 0 } }\n  ) {\n    sessions: nodes {\n      ...TerminalSessionFields\n    }\n  }\n}\n\nquery ScratchTerminalSessions(\n  $projectId: String!\n  $moduleId: String!\n  $limit: Int!\n) {\n  terminal_sessions: agentTerminalSessions(\n    filters: {\n      taskId: { eq: \"00000000-0000-0000-0000-000000000000\" }\n      projectId: { eq: $projectId }\n      moduleId: { eq: $moduleId }\n      scope: { ne: \"shell\" }\n      terminatedAt: { is_null: true }\n    }\n    orderBy: { createdAt: DESC, agentRunId: ASC }\n    pagination: { offset: { limit: $limit, offset: 0 } }\n  ) {\n    sessions: nodes {\n      ...TerminalSessionFields\n    }\n  }\n}\n\nquery TaskResumableTerminalSessions($taskId: String!) {\n  resumable_sessions: resumable_terminal_sessions(task_id: $taskId) {\n    ...ResumableTerminalSessionFields\n  }\n}\n\nquery ScratchResumableTerminalSessions(\n  $projectId: String!\n  $moduleId: String!\n) {\n  resumable_sessions: resumable_terminal_sessions(\n    project_id: $projectId\n    module_id: $moduleId\n  ) {\n    ...ResumableTerminalSessionFields\n  }\n}\n\nmutation CreateTerminalSession(\n  $clientRequestId: String!\n  $projectId: String!\n  $issueId: String!\n  $moduleId: String!\n  $targetId: String!\n  $kind: String!\n  $provider: String!\n  $workingDirectoryIdentity: String!\n  $columns: Int!\n  $rows: Int!\n  $model: String\n  $reasoning: String\n  $policyReference: String\n  $prompt: String\n  $resumeFromAgentRunId: String\n  $automationAttemptId: String\n  $requiredSkills: [String!]\n  $designDirectoryIdentity: String\n  $documentRelativePath: String\n) {\n  terminal_session: terminal_session_create(\n    client_request_id: $clientRequestId\n    project_id: $projectId\n    issue_id: $issueId\n    module_id: $moduleId\n    target_id: $targetId\n    kind: $kind\n    provider: $provider\n    working_directory_identity: $workingDirectoryIdentity\n    columns: $columns\n    rows: $rows\n    model: $model\n    reasoning: $reasoning\n    policy_reference: $policyReference\n    prompt: $prompt\n    resume_from_agent_run_id: $resumeFromAgentRunId\n    automation_attempt_id: $automationAttemptId\n    required_skills: $requiredSkills\n    design_directory_identity: $designDirectoryIdentity\n    document_relative_path: $documentRelativePath\n  ) {\n    ...TerminalSessionFields\n  }\n}\n\nmutation CreateModuleShell(\n  $clientRequestId: String!\n  $moduleId: String!\n  $columns: Int!\n  $rows: Int!\n) {\n  terminal_session: terminal_session_create(\n    client_request_id: $clientRequestId\n    module_id: $moduleId\n    kind: \"shell\"\n    columns: $columns\n    rows: $rows\n  ) {\n    ...TerminalSessionFields\n  }\n}\n\nmutation ResumeTerminalSession(\n  $clientRequestId: String!\n  $projectId: String!\n  $issueId: String!\n  $moduleId: String!\n  $targetId: String!\n  $kind: String!\n  $provider: String!\n  $workingDirectoryIdentity: String!\n  $columns: Int!\n  $rows: Int!\n  $resumeFromAgentRunId: String!\n  $model: String\n  $reasoning: String\n  $policyReference: String\n  $requiredSkills: [String!]\n  $designDirectoryIdentity: String\n) {\n  terminal_session: terminal_session_create(\n    client_request_id: $clientRequestId\n    project_id: $projectId\n    issue_id: $issueId\n    module_id: $moduleId\n    target_id: $targetId\n    kind: $kind\n    provider: $provider\n    working_directory_identity: $workingDirectoryIdentity\n    columns: $columns\n    rows: $rows\n    resume_from_agent_run_id: $resumeFromAgentRunId\n    model: $model\n    reasoning: $reasoning\n    policy_reference: $policyReference\n    required_skills: $requiredSkills\n    design_directory_identity: $designDirectoryIdentity\n  ) {\n    ...TerminalSessionFields\n  }\n}\n\nmutation UpdateTerminalSession(\n  $agentRunId: String!\n  $terminationRequestId: String\n) {\n  terminal_session: terminal_session_update(\n    agent_run_id: $agentRunId\n    termination_request_id: $terminationRequestId\n  ) {\n    ...TerminalSessionFields\n  }\n}";
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
