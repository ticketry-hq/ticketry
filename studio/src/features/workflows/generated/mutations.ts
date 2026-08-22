// Generated-shape documents for authored WorkTracker workflow commands.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";
import { operationDocuments } from "./manifest";
import type { WorkTrackerIssueType, WorkTrackerState } from "./operations";

const document = <TResult, TVariables>(
  operationName: keyof typeof operationDocuments,
): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document",
  operationName,
  source: operationDocuments[operationName],
});

export interface StateMutationVariables { id?: string; projectId?: string; name?: string; group?: string; color?: string | null; sortOrder?: number; }
export const CreateWorkTrackerStateDocument = document<{ create_state: WorkTrackerState }, StateMutationVariables>("CreateWorkTrackerState");
export const UpdateWorkTrackerStateDocument = document<{ update_state: WorkTrackerState }, StateMutationVariables>("UpdateWorkTrackerState");
export const DeleteWorkTrackerStateDocument = document<{ delete_state: boolean }, { id: string }>("DeleteWorkTrackerState");
export const ReorderWorkTrackerStatesDocument = document<{ reorder_states: WorkTrackerState[] }, { projectId: string; orderedIds: string[] }>("ReorderWorkTrackerStates");

export interface IssueTypeMutationVariables { id?: string; projectId?: string; name?: string; level?: string; color?: string | null; sortOrder?: number; reassignTo?: string | null; startStateId?: string; workflowRevision?: number; }
export const CreateWorkTrackerIssueTypeDocument = document<{ create_issue_type: WorkTrackerIssueType }, IssueTypeMutationVariables>("CreateWorkTrackerIssueType");
export const UpdateWorkTrackerIssueTypeDocument = document<{ update_issue_type: WorkTrackerIssueType }, IssueTypeMutationVariables>("UpdateWorkTrackerIssueType");
export const DeleteWorkTrackerIssueTypeDocument = document<{ delete_issue_type: boolean }, IssueTypeMutationVariables>("DeleteWorkTrackerIssueType");
export const ReorderWorkTrackerIssueTypesDocument = document<{ reorder_issue_types: WorkTrackerIssueType[] }, { projectId: string; orderedIds: string[] }>("ReorderWorkTrackerIssueTypes");

export interface RevisionedStateVariables { issueTypeId: string; stateId: string; workflowRevision: number; }
export interface RevisionedTransitionVariables { issueTypeId: string; fromStateId: string; toStateId: string; workflowRevision: number; agentAllowed?: boolean; }
export const SetWorkTrackerStartStateDocument = document<{ update_issue_type: { id: string; workflow_revision: number } }, IssueTypeMutationVariables>("SetWorkTrackerStartState");
export const CreateWorkTrackerTransitionDocument = document<{ create_issue_type_transition: { id: number } }, RevisionedTransitionVariables>("CreateWorkTrackerTransition");
export const DeleteWorkTrackerTransitionDocument = document<{ delete_issue_type_transition: boolean }, RevisionedTransitionVariables>("DeleteWorkTrackerTransition");
export const RemoveWorkTrackerWorkflowStateDocument = document<{ remove_state_from_issue_type_workflow: boolean }, RevisionedStateVariables>("RemoveWorkTrackerWorkflowState");
export const UpdateWorkTrackerTransitionDocument = document<{ update_issue_type_transition: { id: number } }, RevisionedTransitionVariables>("UpdateWorkTrackerTransition");

export interface LaunchBindingMutationVariables extends RevisionedStateVariables { prompt?: string; requiredSkills?: string[]; modelId?: string | null; reasoningId?: string | null; autoStart?: boolean; subtreeRunEnabled?: boolean; enabled?: boolean; }
export const UpsertWorkTrackerLaunchBindingDocument = document<{ upsert_issue_type_launch_binding: { id: number } }, LaunchBindingMutationVariables>("UpsertWorkTrackerLaunchBinding");
export const SetWorkTrackerAutoStartDocument = document<{ upsert_issue_type_launch_binding: { id: number } }, LaunchBindingMutationVariables>("SetWorkTrackerAutoStart");
export const SetWorkTrackerSubtreeRunDocument = document<{ upsert_issue_type_launch_binding: { id: number } }, LaunchBindingMutationVariables>("SetWorkTrackerSubtreeRun");
