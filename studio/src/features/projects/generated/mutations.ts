// Generated-shape documents for authored WorkTracker project commands.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";
import type { WorkTrackerProject, WorkTrackerWorkspace } from "./operations";

const document = <TResult, TVariables>(
  operationName: string,
  source: string,
): TypedDocumentNode<TResult, TVariables> => ({ kind: "Document", operationName, source });

export const AcknowledgeWorkTrackerOnboardingDocument = document<
  { acknowledge_onboarding: WorkTrackerWorkspace }, Record<string, never>
>("AcknowledgeWorkTrackerOnboarding", "mutation AcknowledgeWorkTrackerOnboarding { acknowledge_onboarding { id slug name onboarding_required } }");

export interface ProjectMutationVariables {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
}

export const CreateWorkTrackerProjectDocument = document<
  { create_project: WorkTrackerProject }, ProjectMutationVariables
>("CreateWorkTrackerProject", "mutation CreateWorkTrackerProject($name: String!, $slug: String!, $description: String) { create_project(name: $name, slug: $slug, description: $description) { id name slug description manual_module_order } }");

export const UpdateWorkTrackerProjectDocument = document<
  { update_project: WorkTrackerProject }, ProjectMutationVariables
>("UpdateWorkTrackerProject", "mutation UpdateWorkTrackerProject($id: String!, $name: String, $description: String) { update_project(id: $id, name: $name, description: $description) { id name slug description manual_module_order } }");

export const DeleteWorkTrackerProjectDocument = document<
  { delete_project: boolean }, { id: string }
>("DeleteWorkTrackerProject", "mutation DeleteWorkTrackerProject($id: String!) { delete_project(id: $id) }");
