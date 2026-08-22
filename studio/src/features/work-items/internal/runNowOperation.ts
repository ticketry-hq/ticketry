import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";
import { operationDocuments } from "../generated/manifest";

export interface RunNowPayload {
  readonly target_id: string;
  readonly code: string;
  readonly detail: string;
  readonly remedy: string | null;
  readonly committed_state: { readonly id: string; readonly name: string } | null;
  readonly run: {
    readonly target_id: string;
    readonly agent: string;
    readonly agent_run_id: string;
  } | null;
}

export const RunWorkTrackerWorkItemNowDocument: TypedDocumentNode<
  { readonly run_now: RunNowPayload },
  { readonly idOrKey: string; readonly requestIdentity: string }
> = {
  kind: "Document",
  operationName: "RunWorkTrackerWorkItemNow",
  source: operationDocuments.RunWorkTrackerWorkItemNow,
};
