// Generated from operations/projects.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface WorkTrackerWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly onboarding_required: boolean;
}

export interface WorkTrackerWorkspaceQuery {
  readonly workspace: WorkTrackerWorkspace | null;
}

export type WorkTrackerWorkspaceVariables = Record<string, never>;

export interface WorkTrackerProject {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly manual_module_order: boolean;
}

export interface WorkTrackerModule {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly key: string;
  readonly is_archived: boolean;
  readonly issue_type: string;
}

export interface WorkTrackerProjectsQuery {
  readonly projects: ReadonlyArray<WorkTrackerProject>;
}

export type WorkTrackerProjectsVariables = Record<string, never>;

export interface WorkTrackerModulesQuery {
  readonly modules: ReadonlyArray<WorkTrackerModule>;
}

export interface WorkTrackerModulesVariables {
  readonly projectId: string;
  readonly includeArchived?: boolean | null;
}

export const WorkTrackerWorkspaceDocument: TypedDocumentNode<
  WorkTrackerWorkspaceQuery,
  WorkTrackerWorkspaceVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkspace",
  source: "query WorkTrackerWorkspace {\n  workspace {\n    id\n    slug\n    name\n    onboarding_required\n  }\n}",
};

export const WorkTrackerProjectsDocument: TypedDocumentNode<
  WorkTrackerProjectsQuery,
  WorkTrackerProjectsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerProjects",
  source: "query WorkTrackerProjects {\n  projects {\n    id\n    name\n    slug\n    description\n    manual_module_order\n  }\n}",
};

export const WorkTrackerModulesDocument: TypedDocumentNode<
  WorkTrackerModulesQuery,
  WorkTrackerModulesVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerModules",
  source: "query WorkTrackerModules($projectId: String!, $includeArchived: Boolean) {\n  modules(project_id: $projectId, include_archived: $includeArchived) {\n    id\n    name\n    project_id\n    sequence_id\n    key\n    is_archived\n    issue_type\n  }\n}",
};
