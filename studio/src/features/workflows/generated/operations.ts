// Generated from operations/workflows.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface WorkTrackerState {
  readonly id: string;
  readonly project: string;
  readonly name: string;
  readonly group: string;
  readonly color: string;
  readonly sort_order: number;
  readonly is_protected: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkTrackerIssueType {
  readonly id: string;
  readonly project: string;
  readonly name: string;
  readonly level: string;
  readonly color: string;
  readonly sort_order: number;
  readonly start_state: string | null;
  readonly workflow_revision: number;
  readonly is_pathfind: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkTrackerLaunchBinding {
  readonly id: number;
  readonly issue_type: string;
  readonly state: string;
  readonly prompt: string;
  readonly required_skills: ReadonlyArray<string>;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly auto_start: boolean;
  readonly subtree_run_enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkTrackerWorkflowCatalogQuery {
  readonly states: ReadonlyArray<WorkTrackerState>;
  readonly issue_types: ReadonlyArray<WorkTrackerIssueType>;
  readonly launch_bindings: ReadonlyArray<WorkTrackerLaunchBinding>;
  readonly providers: ReadonlyArray<WorkTrackerProvider>;
  readonly agent_models: ReadonlyArray<WorkTrackerAgentModel>;
  readonly reasoning_levels: ReadonlyArray<WorkTrackerReasoningLevel>;
}

export interface WorkTrackerWorkflowCatalogVariables {
  readonly projectId: string;
}

export interface WorkTrackerProvider {
  readonly id: string;
  readonly slug: string;
  readonly activated: boolean;
  readonly supports_unattended: boolean;
}

export interface WorkTrackerAgentModel {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly permitted_reasoning_levels: ReadonlyArray<string>;
}

export interface WorkTrackerReasoningLevel {
  readonly id: string;
  readonly name: string;
}

export interface WorkTrackerIssueTypeTransition {
  readonly id: number;
  readonly issue_type: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly agent_allowed: boolean;
}

export interface WorkTrackerIssueTypeTransitionsQuery {
  readonly issue_type_transitions: ReadonlyArray<WorkTrackerIssueTypeTransition>;
}

export interface WorkTrackerIssueTypeTransitionsVariables {
  readonly issueTypeId: string;
}

export const WorkTrackerWorkflowCatalogDocument: TypedDocumentNode<
  WorkTrackerWorkflowCatalogQuery,
  WorkTrackerWorkflowCatalogVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkflowCatalog",
  source: "query WorkTrackerWorkflowCatalog($projectId: String!) {\n  states(project_id: $projectId) {\n    id\n    project\n    name\n    group\n    color\n    sort_order\n    is_protected\n    created_at\n    updated_at\n  }\n  issue_types(project_id: $projectId) {\n    id\n    project\n    name\n    level\n    color\n    sort_order\n    start_state\n    workflow_revision\n    is_pathfind\n    created_at\n    updated_at\n  }\n  launch_bindings(project_id: $projectId) {\n    id\n    issue_type\n    state\n    prompt\n    required_skills\n    model\n    reasoning\n    auto_start\n    subtree_run_enabled\n    created_at\n    updated_at\n  }\n  providers {\n    id\n    slug\n    activated\n    supports_unattended\n  }\n  agent_models {\n    id\n    provider\n    name\n    permitted_reasoning_levels\n  }\n  reasoning_levels {\n    id\n    name\n  }\n}",
};

export const WorkTrackerIssueTypeTransitionsDocument: TypedDocumentNode<
  WorkTrackerIssueTypeTransitionsQuery,
  WorkTrackerIssueTypeTransitionsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerIssueTypeTransitions",
  source: "query WorkTrackerIssueTypeTransitions($issueTypeId: String!) {\n  issue_type_transitions(issue_type_id: $issueTypeId) {\n    id\n    issue_type\n    from_state\n    to_state\n    agent_allowed\n  }\n}",
};
