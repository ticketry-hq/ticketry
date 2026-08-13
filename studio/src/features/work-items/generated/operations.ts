// Generated from operations/workItems.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export interface WorkTrackerWorkItem {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
  readonly sequence_id: number;
  readonly state: string | null;
  readonly state_revision: number;
  readonly description: string;
  readonly parent_id: string | null;
  readonly sub_issues_count: number;
  readonly key: string;
  readonly is_archived: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly rank: string;
  readonly issue_type: string;
  readonly blocked_by_ids: ReadonlyArray<string>;
  readonly blocks_ids: ReadonlyArray<string>;
}

export interface WorkTrackerWorkItemsQuery {
  readonly work_items: ReadonlyArray<WorkTrackerWorkItem>;
}

export interface WorkTrackerWorkItemsVariables {
  readonly projectId?: string | null;
  readonly moduleId?: string | null;
  readonly stateId?: string | null;
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
  readonly work_items: ReadonlyArray<WorkTrackerWorkItem>;
  readonly states: ReadonlyArray<WorkTrackerModuleTreeState>;
}

export interface WorkTrackerModuleTreeVariables {
  readonly projectId: string;
  readonly moduleId: string;
}

export interface WorkTrackerWorkItemsByIdsQuery {
  readonly work_items_by_ids: ReadonlyArray<WorkTrackerWorkItem>;
}

export interface WorkTrackerWorkItemsByIdsVariables {
  readonly ids: ReadonlyArray<string>;
}

export interface WorkTrackerWorkItemQuery {
  readonly work_item: WorkTrackerWorkItem | null;
}

export interface WorkTrackerWorkItemVariables {
  readonly id: string;
}

const fields = "fragment WorkTrackerWorkItemFields on WorkItem {\n  id\n  name\n  project_id\n  sequence_id\n  state\n  state_revision\n  description\n  parent_id\n  sub_issues_count\n  key\n  is_archived\n  created_at\n  updated_at\n  rank\n  issue_type\n  blocked_by_ids\n  blocks_ids\n}";

export const WorkTrackerWorkItemsDocument: TypedDocumentNode<
  WorkTrackerWorkItemsQuery,
  WorkTrackerWorkItemsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItems",
  source: `${fields}\n\nquery WorkTrackerWorkItems($projectId: String, $moduleId: String, $stateId: String) {\n  work_items(project_id: $projectId, module_id: $moduleId, state_id: $stateId) {\n    ...WorkTrackerWorkItemFields\n  }\n}`,
};

export const WorkTrackerWorkItemsByIdsDocument: TypedDocumentNode<
  WorkTrackerWorkItemsByIdsQuery,
  WorkTrackerWorkItemsByIdsVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItemsByIds",
  source: `${fields}\n\nquery WorkTrackerWorkItemsByIds($ids: [String!]!) {\n  work_items_by_ids(ids: $ids) {\n    ...WorkTrackerWorkItemFields\n  }\n}`,
};

export const WorkTrackerModuleTreeDocument: TypedDocumentNode<
  WorkTrackerModuleTreeQuery,
  WorkTrackerModuleTreeVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerModuleTree",
  source: `${fields}\n\nquery WorkTrackerModuleTree($projectId: String!, $moduleId: String!) {\n  work_items(module_id: $moduleId) {\n    ...WorkTrackerWorkItemFields\n  }\n  states(project_id: $projectId) {\n    id\n    name\n    group\n    color\n    sort_order\n    is_protected\n  }\n}`,
};

export const WorkTrackerWorkItemDocument: TypedDocumentNode<
  WorkTrackerWorkItemQuery,
  WorkTrackerWorkItemVariables
> = {
  kind: "Document",
  operationName: "WorkTrackerWorkItem",
  source: `${fields}\n\nquery WorkTrackerWorkItem($id: String!) {\n  work_item(id: $id) {\n    ...WorkTrackerWorkItemFields\n  }\n}`,
};
