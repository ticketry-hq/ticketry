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
  readonly required_skills: unknown;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly auto_start: boolean;
  readonly subtree_run_enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly issueType: { readonly sort_order: number } | null;
  readonly state_record: { readonly sort_order: number } | null;
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
  readonly provider_record: { readonly slug: string } | null;
  readonly reasoning_levels: {
    readonly nodes: ReadonlyArray<{ readonly reasoning_level_id: string }>;
  };
}

export interface WorkTrackerReasoningLevel {
  readonly id: string;
  readonly name: string;
}

export interface WorkTrackerWorkflowCatalogQuery {
  readonly states: { readonly nodes: ReadonlyArray<WorkTrackerState> };
  readonly issue_types: { readonly nodes: ReadonlyArray<WorkTrackerIssueType> };
  readonly launch_bindings: { readonly nodes: ReadonlyArray<WorkTrackerLaunchBinding> };
  readonly providers: { readonly nodes: ReadonlyArray<WorkTrackerProvider> };
  readonly agent_models: { readonly nodes: ReadonlyArray<WorkTrackerAgentModel> };
  readonly reasoning_levels: { readonly nodes: ReadonlyArray<WorkTrackerReasoningLevel> };
}

export interface WorkTrackerWorkflowCatalogVariables {
  readonly projectId: string;
}

export interface WorkTrackerIssueTypeTransition {
  readonly id: number;
  readonly issue_type: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly agent_allowed: boolean;
  readonly fromState: { readonly sort_order: number } | null;
  readonly toState: { readonly sort_order: number } | null;
}

export interface WorkTrackerIssueTypeTransitionsQuery {
  readonly issue_type_transitions: {
    readonly nodes: ReadonlyArray<WorkTrackerIssueTypeTransition>;
  };
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
  source: `query WorkTrackerWorkflowCatalog($projectId: String!) {
    states: worktrackerState(filters: { projectId: { eq: $projectId } }) { nodes { id project: projectId name group color sort_order: sortOrder is_protected: isProtected created_at: createdAt updated_at: updatedAt } }
    issue_types: worktrackerIssuetype(filters: { projectId: { eq: $projectId } }) { nodes { id project: projectId name level color sort_order: sortOrder start_state: startStateId workflow_revision: workflowRevision is_pathfind: isPathfind created_at: createdAt updated_at: updatedAt } }
    launch_bindings: worktrackerLaunchbinding(having: { issueType: { projectId: { eq: $projectId } } }) { nodes { id issue_type: issueTypeId state: stateId prompt required_skills: requiredSkills model: modelId reasoning: reasoningId auto_start: autoStart subtree_run_enabled: subtreeRunEnabled created_at: createdAt updated_at: updatedAt issueType { sort_order: sortOrder } state_record: state { sort_order: sortOrder } } }
    providers: worktrackerProvider { nodes { id slug activated supports_unattended: supportsUnattended } }
    agent_models: worktrackerAgentmodel { nodes { id provider: providerId name provider_record: provider { slug } reasoning_levels: agentModelReasoningLevel { nodes { reasoning_level_id: reasoningLevelId } } } }
    reasoning_levels: worktrackerReasoninglevel { nodes { id name } }
  }`,
};

export const WorkTrackerIssueTypeTransitionsDocument: TypedDocumentNode<
  WorkTrackerIssueTypeTransitionsQuery,
  WorkTrackerIssueTypeTransitionsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerIssueTypeTransitions",
  source: `query WorkTrackerIssueTypeTransitions($issueTypeId: String!) { issue_type_transitions: worktrackerIssuetypetransition(filters: { issueTypeId: { eq: $issueTypeId } }) { nodes { id issue_type: issueTypeId from_state: fromStateId to_state: toStateId agent_allowed: agentAllowed fromState { sort_order: sortOrder } toState { sort_order: sortOrder } } } }`,
};
