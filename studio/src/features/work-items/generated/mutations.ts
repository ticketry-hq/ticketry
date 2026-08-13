// Generated-shape documents for authored WorkTracker item commands.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";
import type { WorkTrackerWorkItem } from "./operations";

const fields = "id name project_id sequence_id state state_revision description parent_id sub_issues_count key is_archived created_at updated_at rank issue_type blocked_by_ids blocks_ids";
const document = <TResult, TVariables>(operationName: string, source: string): TypedDocumentNode<TResult, TVariables> => ({ kind: "Document", operationName, source });

export interface CreateWorkItemVariables {
  projectId: string; name: string; issueTypeId: string; description?: string | null;
  stateId?: string | null; parentId?: string | null;
}
export const CreateWorkTrackerWorkItemDocument = document<
  { create_work_item: WorkTrackerWorkItem }, CreateWorkItemVariables
>("CreateWorkTrackerWorkItem", `mutation CreateWorkTrackerWorkItem($projectId: String!, $name: String!, $issueTypeId: String!, $description: String, $stateId: String, $parentId: String) { create_work_item(project_id: $projectId, name: $name, issue_type_id: $issueTypeId, description: $description, state_id: $stateId, parent_id: $parentId) { ${fields} } }`);

export interface UpdateWorkItemVariables { id: string; name?: string; description?: string | null; issueTypeId?: string; }
export const UpdateWorkTrackerWorkItemDocument = document<
  { update_work_item: WorkTrackerWorkItem }, UpdateWorkItemVariables
>("UpdateWorkTrackerWorkItem", `mutation UpdateWorkTrackerWorkItem($id: String!, $name: String, $description: String, $issueTypeId: String) { update_work_item(id: $id, name: $name, description: $description, issue_type_id: $issueTypeId) { ${fields} } }`);

export const TransitionWorkTrackerWorkItemDocument = document<
  { transition_work_item: WorkTrackerWorkItem }, { id: string; targetStateId: string }
>("TransitionWorkTrackerWorkItem", `mutation TransitionWorkTrackerWorkItem($id: String!, $targetStateId: String!) { transition_work_item(id: $id, target_state_id: $targetStateId, origin: "human") { ${fields} } }`);

export const ReparentWorkTrackerWorkItemDocument = document<
  { reparent_work_item: WorkTrackerWorkItem }, { id: string; parentId: string | null }
>("ReparentWorkTrackerWorkItem", `mutation ReparentWorkTrackerWorkItem($id: String!, $parentId: String) { reparent_work_item(id: $id, parent_id: $parentId) { ${fields} } }`);

export const SetWorkTrackerBlockersDocument = document<
  { set_work_item_blockers: WorkTrackerWorkItem }, { id: string; blockedByIds: string[] }
>("SetWorkTrackerBlockers", `mutation SetWorkTrackerBlockers($id: String!, $blockedByIds: [String!]!) { set_work_item_blockers(id: $id, blocked_by_ids: $blockedByIds) { ${fields} } }`);

export interface ReorderWorkItemVariables { id: string; beforeId: string | null; afterId: string | null; initialOrderIds?: string[] | null; }
export const ReorderWorkTrackerWorkItemDocument = document<
  { reorder_work_item: WorkTrackerWorkItem }, ReorderWorkItemVariables
>("ReorderWorkTrackerWorkItem", `mutation ReorderWorkTrackerWorkItem($id: String!, $beforeId: String, $afterId: String, $initialOrderIds: [String!]) { reorder_work_item(id: $id, before_id: $beforeId, after_id: $afterId, initial_order_ids: $initialOrderIds) { ${fields} } }`);

export const DeleteWorkTrackerWorkItemDocument = document<
  { delete_work_item: boolean }, { id: string }
>("DeleteWorkTrackerWorkItem", "mutation DeleteWorkTrackerWorkItem($id: String!) { delete_work_item(id: $id) }");
