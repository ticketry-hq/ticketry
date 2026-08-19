// Generated from operations/documentSave.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

/**
 * What one save was answered with. `stale` means the file had already moved
 * on and was left untouched; `digest` is then the version it actually holds.
 */
export interface DocumentSaveOutcome {
  readonly document_id: string;
  readonly digest: string;
  readonly saved: boolean;
  readonly stale: boolean;
}

export interface SaveDesignDocumentVariables {
  readonly documentId: string;
  readonly expectedDigest: string;
  readonly content: string;
  readonly operationId: string;
}
export interface SaveDesignDocumentMutation {
  readonly save_design_document: DocumentSaveOutcome;
}

const source = "mutation SaveDesignDocument(\n  $documentId: String!\n  $expectedDigest: String!\n  $content: String!\n  $operationId: String!\n) {\n  save_design_document(\n    document_id: $documentId\n    expected_digest: $expectedDigest\n    content: $content\n    operation_id: $operationId\n  ) {\n    document_id\n    digest\n    saved\n    stale\n  }\n}";

export const SaveDesignDocumentDocument: TypedDocumentNode<
  SaveDesignDocumentMutation,
  SaveDesignDocumentVariables
> = {
  kind: "Document",
  operationName: "SaveDesignDocument",
  source,
};
