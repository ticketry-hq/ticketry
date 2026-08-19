// Generated-shape documents for authored WorkTracker item commands.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";
import type { GeneratedWorkTrackerWorkItem } from "./operations";

const fields = `id name project_id: projectId sequence_id: sequenceId
  state_id: stateId state_revision: stateRevision description parent_id: parentId
  module_id: moduleId is_archived: isArchived created_at: createdAt
  updated_at: updatedAt rank issue_type_id: issueTypeId project { slug }
  children(filters: { isArchived: { eq: false } }) { nodes { id } }
  blocked_by_edges: blockedByEdges { nodes { to_issue_id: toIssueId } }
  blocks_edges: blocksEdges { nodes { from_issue_id: fromIssueId } }`;
const document = <TResult, TVariables>(operationName: string, source: string): TypedDocumentNode<TResult, TVariables> => ({ kind: "Document", operationName, source });

export interface CreateWorkItemVariables {
  projectId: string; name: string; issueTypeId: string; description?: string | null;
  stateId?: string | null; parentId?: string | null;
}
export const CreateWorkTrackerWorkItemDocument = document<
  { create_work_item: GeneratedWorkTrackerWorkItem }, CreateWorkItemVariables
>("CreateWorkTrackerWorkItem", `mutation CreateWorkTrackerWorkItem($projectId: String!, $name: String!, $issueTypeId: String!, $description: String, $stateId: String, $parentId: String) { create_work_item(project_id: $projectId, name: $name, issue_type_id: $issueTypeId, description: $description, state_id: $stateId, parent_id: $parentId) { ${fields} } }`);

export interface UpdateWorkItemVariables { id: string; name?: string; description?: string | null; issueTypeId?: string; }
export const UpdateWorkTrackerWorkItemDocument = document<
  { update_work_item: GeneratedWorkTrackerWorkItem }, UpdateWorkItemVariables
>("UpdateWorkTrackerWorkItem", `mutation UpdateWorkTrackerWorkItem($id: String!, $name: String, $description: String, $issueTypeId: String) { update_work_item(id: $id, name: $name, description: $description, issue_type_id: $issueTypeId) { ${fields} } }`);

export const TransitionWorkTrackerWorkItemDocument = document<
  { update_work_item: GeneratedWorkTrackerWorkItem }, { id: string; targetStateId: string }
>("TransitionWorkTrackerWorkItem", `mutation TransitionWorkTrackerWorkItem($id: String!, $targetStateId: String!) { update_work_item(id: $id, state_id: $targetStateId) { ${fields} } }`);

export const ReparentWorkTrackerWorkItemDocument = document<
  { update_work_item: GeneratedWorkTrackerWorkItem }, { id: string; parentId: string | null }
>("ReparentWorkTrackerWorkItem", `mutation ReparentWorkTrackerWorkItem($id: String!, $parentId: String) { update_work_item(id: $id, parent_id: $parentId) { ${fields} } }`);

export const SetWorkTrackerBlockersDocument = document<
  { update_work_item: GeneratedWorkTrackerWorkItem }, { id: string; blockedByIds: string[] }
>("SetWorkTrackerBlockers", `mutation SetWorkTrackerBlockers($id: String!, $blockedByIds: [String!]!) { update_work_item(id: $id, blocked_by_ids: $blockedByIds) { ${fields} } }`);

export interface ReorderWorkItemVariables { id: string; beforeId: string | null; afterId: string | null; initialOrderIds?: string[] | null; }
export const ReorderWorkTrackerWorkItemDocument = document<
  { reorder_work_item: GeneratedWorkTrackerWorkItem }, ReorderWorkItemVariables
>("ReorderWorkTrackerWorkItem", `mutation ReorderWorkTrackerWorkItem($id: String!, $beforeId: String, $afterId: String, $initialOrderIds: [String!]) { reorder_work_item(id: $id, before_id: $beforeId, after_id: $afterId, initial_order_ids: $initialOrderIds) { ${fields} } }`);

export const DeleteWorkTrackerWorkItemDocument = document<
  { delete_work_item: boolean }, { id: string }
>("DeleteWorkTrackerWorkItem", "mutation DeleteWorkTrackerWorkItem($id: String!) { delete_work_item(id: $id) }");
