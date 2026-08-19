// Generated from operations/workItems.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface GeneratedWorkTrackerWorkItem {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly state_id: string | null;
  readonly state_revision: number;
  readonly description: string;
  readonly parent_id: string | null;
  readonly module_id: string | null;
  readonly is_archived: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly rank: string;
  readonly issue_type_id: string;
  readonly project: { readonly slug: string } | null;
  readonly children: { readonly nodes: ReadonlyArray<{ readonly id: string }> };
  readonly blocked_by_edges: {
    readonly nodes: ReadonlyArray<{ readonly to_issue_id: string }>;
  };
  readonly blocks_edges: {
    readonly nodes: ReadonlyArray<{ readonly from_issue_id: string }>;
  };
}

interface WorkItemConnection {
  readonly nodes: ReadonlyArray<GeneratedWorkTrackerWorkItem>;
}

export interface WorkTrackerWorkItemsQuery {
  readonly work_items: WorkItemConnection;
}

export interface WorkTrackerWorkItemsVariables {
  readonly projectId: string;
}

export interface WorkTrackerModuleTreeState {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly color: string;
  readonly sort_order: number;
  readonly is_protected: boolean;
}

export interface WorkTrackerModuleTreeQuery {
  readonly work_items: WorkItemConnection;
  readonly states: { readonly nodes: ReadonlyArray<WorkTrackerModuleTreeState> };
}

export interface WorkTrackerModuleTreeVariables {
  readonly projectId: string;
  readonly moduleId: string;
}

export interface WorkTrackerWorkItemsByIdsQuery {
  readonly work_items_by_ids: WorkItemConnection;
}

export interface WorkTrackerWorkItemsByIdsVariables {
  readonly ids: ReadonlyArray<string>;
}

export interface WorkTrackerWorkItemQuery {
  readonly work_item: WorkItemConnection;
}

export interface WorkTrackerWorkItemVariables {
  readonly id: string;
}

export interface WorkTrackerWorkItemByKeyVariables {
  readonly projectSlug: string;
  readonly sequenceId: number;
}

const generatedFields = `fragment GeneratedWorkTrackerWorkItemFields on WorktrackerIssue {
  id name project_id: projectId sequence_id: sequenceId state_id: stateId
  state_revision: stateRevision description parent_id: parentId module_id: moduleId
  is_archived: isArchived created_at: createdAt updated_at: updatedAt rank
  issue_type_id: issueTypeId project { slug }
  children(filters: { isArchived: { eq: false } }) { nodes { id } }
  blocked_by_edges: blockedByEdges { nodes { to_issue_id: toIssueId } }
  blocks_edges: blocksEdges { nodes { from_issue_id: fromIssueId } }
}`;

export const WorkTrackerWorkItemsDocument: TypedDocumentNode<
  WorkTrackerWorkItemsQuery,
  WorkTrackerWorkItemsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItems",
  source: `${generatedFields}\nquery WorkTrackerWorkItems($projectId: String!) { work_items: worktrackerIssue(filters: { projectId: { eq: $projectId }, type: { eq: "task" } }) { nodes { ...GeneratedWorkTrackerWorkItemFields } } }`,
};

export const WorkTrackerWorkItemsByIdsDocument: TypedDocumentNode<
  WorkTrackerWorkItemsByIdsQuery,
  WorkTrackerWorkItemsByIdsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItemsByIds",
  source: `${generatedFields}\nquery WorkTrackerWorkItemsByIds($ids: [String!]!) { work_items_by_ids: worktrackerIssue(filters: { id: { is_in: $ids }, type: { eq: "task" } }) { nodes { ...GeneratedWorkTrackerWorkItemFields } } }`,
};

export const WorkTrackerModuleTreeDocument: TypedDocumentNode<
  WorkTrackerModuleTreeQuery,
  WorkTrackerModuleTreeVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerModuleTree",
  source: `${generatedFields}\nquery WorkTrackerModuleTree($projectId: String!, $moduleId: String!) { work_items: worktrackerIssue(filters: { moduleId: { eq: $moduleId }, type: { eq: "task" } }) { nodes { ...GeneratedWorkTrackerWorkItemFields } } states: worktrackerState(filters: { projectId: { eq: $projectId } }) { nodes { id name group color sort_order: sortOrder is_protected: isProtected } } }`,
};

export const WorkTrackerWorkItemDocument: TypedDocumentNode<
  WorkTrackerWorkItemQuery,
  WorkTrackerWorkItemVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItem",
  source: `${generatedFields}\nquery WorkTrackerWorkItem($id: String!) { work_item: worktrackerIssue(filters: { id: { eq: $id }, type: { eq: "task" } }) { nodes { ...GeneratedWorkTrackerWorkItemFields } } }`,
};

export const WorkTrackerWorkItemByKeyDocument: TypedDocumentNode<
  WorkTrackerWorkItemQuery,
  WorkTrackerWorkItemByKeyVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItemByKey",
  source: `${generatedFields}\nquery WorkTrackerWorkItemByKey($projectSlug: String!, $sequenceId: Int!) { work_item: worktrackerIssue(filters: { sequenceId: { eq: $sequenceId }, type: { eq: "task" } }, having: { project: { slug: { eq: $projectSlug } } }) { nodes { ...GeneratedWorkTrackerWorkItemFields } } }`,
};
