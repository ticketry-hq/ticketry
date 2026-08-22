// Generated from operations/viewerLeases.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../../graphql-foundation/typedDocument";

export interface ViewerLeasePayload {
  readonly agent_run_id: string;
  readonly viewer_id: string;
  readonly transport: "native" | "xterm";
  readonly generation: string;
  readonly acquired_at: string;
  readonly expires_at: string;
}

export interface CreateViewerLeaseVariables {
  readonly agentRunId: string;
  readonly viewerId: string;
  readonly transport: "native" | "xterm";
}
export interface OwnedViewerLeaseVariables {
  readonly agentRunId: string;
  readonly viewerId: string;
  readonly generation: string;
}
export interface ViewerLeaseMutation {
  readonly viewer_lease: ViewerLeasePayload;
}
export interface DeleteViewerLeaseMutation {
  readonly viewer_lease: ViewerLeasePayload | null;
}

const source = "fragment ViewerLeaseFields on AgentRunViewerLeases {\n  agent_run_id: agentRunId\n  viewer_id: viewerId\n  transport\n  generation\n  acquired_at: acquiredAt\n  expires_at: expiresAt\n}\n\nmutation CreateViewerLease(\n  $agentRunId: String!\n  $viewerId: String!\n  $transport: String!\n) {\n  viewer_lease: create_viewer_lease(\n    agent_run_id: $agentRunId\n    viewer_id: $viewerId\n    transport: $transport\n  ) {\n    ...ViewerLeaseFields\n  }\n}\n\nmutation UpdateViewerLease(\n  $agentRunId: String!\n  $viewerId: String!\n  $generation: String!\n) {\n  viewer_lease: update_viewer_lease(\n    agent_run_id: $agentRunId\n    viewer_id: $viewerId\n    generation: $generation\n  ) {\n    ...ViewerLeaseFields\n  }\n}\n\nmutation DeleteViewerLease(\n  $agentRunId: String!\n  $viewerId: String!\n  $generation: String!\n) {\n  viewer_lease: delete_viewer_lease(\n    agent_run_id: $agentRunId\n    viewer_id: $viewerId\n    generation: $generation\n  ) {\n    ...ViewerLeaseFields\n  }\n}";
const document = <TResult, TVariables>(operationName: string): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document", operationName, source,
});
export const CreateViewerLeaseDocument = document<ViewerLeaseMutation, CreateViewerLeaseVariables>("CreateViewerLease");
export const UpdateViewerLeaseDocument = document<ViewerLeaseMutation, OwnedViewerLeaseVariables>("UpdateViewerLease");
export const DeleteViewerLeaseDocument = document<DeleteViewerLeaseMutation, OwnedViewerLeaseVariables>("DeleteViewerLease");
