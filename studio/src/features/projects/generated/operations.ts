// Generated from operations/projects.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface WorkTrackerWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly onboarding_required: boolean;
}

export interface WorkTrackerWorkspaceQuery {
  readonly workspace: { readonly nodes: ReadonlyArray<WorkTrackerWorkspace> };
}

export type WorkTrackerWorkspaceVariables = Record<string, never>;

export interface WorkTrackerProject {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly manual_module_order: boolean;
  readonly created_at: string;
}

export interface WorkTrackerModule {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly is_archived: boolean;
  readonly issue_type: string;
  readonly rank: string;
  readonly project: {
    readonly slug: string;
    readonly manual_module_order: boolean;
  };
}

export interface WorkTrackerProjectsQuery {
  readonly projects: { readonly nodes: ReadonlyArray<WorkTrackerProject> };
}

export type WorkTrackerProjectsVariables = Record<string, never>;

export interface WorkTrackerModulesQuery {
  readonly modules: { readonly nodes: ReadonlyArray<WorkTrackerModule> };
}

export interface WorkTrackerModulesVariables {
  readonly projectId: string;
}

export const WorkTrackerWorkspaceDocument: TypedDocumentNode<
  WorkTrackerWorkspaceQuery,
  WorkTrackerWorkspaceVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkspace",
  source: "query WorkTrackerWorkspace {\n  workspace: worktrackerWorkspace {\n    nodes {\n      id\n      slug\n      name\n      onboarding_required: onboardingRequired\n    }\n  }\n}",
};

export const WorkTrackerProjectsDocument: TypedDocumentNode<
  WorkTrackerProjectsQuery,
  WorkTrackerProjectsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerProjects",
  source: "query WorkTrackerProjects {\n  projects: worktrackerProject {\n    nodes {\n      id\n      name\n      slug\n      description\n      manual_module_order: manualModuleOrder\n      created_at: createdAt\n    }\n  }\n}",
};

export const WorkTrackerModulesDocument: TypedDocumentNode<
  WorkTrackerModulesQuery,
  WorkTrackerModulesVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerModules",
  source: "query WorkTrackerModules($projectId: String!) {\n  modules: worktrackerIssue(filters: { projectId: { eq: $projectId }, type: { eq: \"module\" } }) {\n    nodes {\n      id\n      name\n      project_id: projectId\n      sequence_id: sequenceId\n      is_archived: isArchived\n      issue_type: issueTypeId\n      rank\n      project {\n        slug\n        manual_module_order: manualModuleOrder\n      }\n    }\n  }\n}",
};
