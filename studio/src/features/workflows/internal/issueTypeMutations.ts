import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { IssueType, IssueTypeCreate, IssueTypePatch } from "../../../shared/api/types";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  CreateWorkTrackerIssueTypeDocument,
  type CreateWorkTrackerIssueTypeMutation,
  DeleteWorkTrackerIssueTypeDocument,
  ReorderWorkTrackerIssueTypesDocument,
  UpdateWorkTrackerIssueTypeDocument,
} from "../generated/workflows.documents";
import { workflowCatalog } from "./stateMutations";

type IssueTypeRow = CreateWorkTrackerIssueTypeMutation["create_issue_type"];

const issueType = (row: IssueTypeRow): IssueType => ({
  id: row.id,
  project: row.project,
  name: row.name,
  level: row.level as IssueType["level"],
  color: row.color,
  sort_order: row.sort_order,
  start_state: row.start_state,
  workflow_revision: row.workflow_revision,
});

export interface IssueTypeCreation {
  projectId: string;
  body: IssueTypeCreate;
}

/** Create an issue type: the project's workflow catalog gains it. */
export const issueTypeCreationMutation = declareMutation({
  document: CreateWorkTrackerIssueTypeDocument,
  variables: ({ projectId, body }: IssueTypeCreation) => ({
    projectId,
    name: body.name,
    level: body.level,
    color: body.color,
  }),
  root: "create_issue_type",
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
  result: issueType,
});

export interface IssueTypeUpdate {
  id: string;
  patch: IssueTypePatch;
}

/** Rename, recolor or reposition an issue type in its project's catalog. */
export const issueTypeUpdateMutation = declareMutation({
  document: UpdateWorkTrackerIssueTypeDocument,
  variables: ({ id, patch }: IssueTypeUpdate) => ({
    id,
    name: patch.name,
    color: patch.color,
    sortOrder: patch.sort_order,
  }),
  root: "update_issue_type",
  refresh: (_update, row) => [workflowCatalog(row.project)],
  result: issueType,
});

export interface IssueTypeDeletion {
  projectId: string;
  id: string;
  reassignTo?: string;
}

/** Delete an issue type, reassigning its work items when asked; its identity leaves the cache. */
export const issueTypeDeletionMutation = declareMutation({
  document: DeleteWorkTrackerIssueTypeDocument,
  variables: ({ id, reassignTo }: IssueTypeDeletion) => ({ id, reassignTo }),
  root: "delete_issue_type",
  evict: ({ id }) => [{ __typename: "WorktrackerIssuetype", id: compactWorktrackerId(id) }],
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
  result: () => undefined,
});

export interface IssueTypeReorder {
  projectId: string;
  orderedIds: string[];
}

/** Reorder a project's issue types, the quarantined domain operation; ranks settle to the server's. */
export const issueTypeReorderMutation = declareMutation({
  document: ReorderWorkTrackerIssueTypesDocument,
  variables: ({ projectId, orderedIds }: IssueTypeReorder) => ({ projectId, orderedIds }),
  root: "reorder_issue_types",
  refresh: ({ projectId }) => [workflowCatalog(projectId)],
  result: (rows) => rows.map(issueType),
});
