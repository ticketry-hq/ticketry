// Generated from operations/documentRegistry.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

/**
 * One registered document, selected from the generated `DesignDocuments`
 * model output. The registry publishes no absolute root and no discovery
 * provenance, and the tab label is derived from the relative path rather than
 * stored, so the two never disagree.
 */
export interface DesignDocumentRow {
  readonly id: string;
  readonly relPath: string;
  /**
   * The bytes the registry currently describes. It changes when the file
   * changes, which is what lets an open viewer notice an external rewrite of a
   * document whose identity and path did not move.
   */
  readonly contentDigest: string | null;
}

export interface RefreshTaskDocumentRegistryVariables {
  readonly taskId: string;
  readonly projectId?: string | null;
  readonly moduleId?: string | null;
}
export interface RefreshTaskDocumentRegistryMutation {
  readonly refresh_task_document_registry: ReadonlyArray<DesignDocumentRow>;
}

export interface RefreshScratchDocumentRegistryVariables {
  readonly moduleId: string;
}
export interface RefreshScratchDocumentRegistryMutation {
  readonly refresh_scratch_document_registry: ReadonlyArray<DesignDocumentRow>;
}

export interface CompleteDirectoriesVariables {
  readonly path: string;
}
export interface CompleteDirectoriesQuery {
  readonly directory_completions: ReadonlyArray<string>;
}

const source = "mutation RefreshTaskDocumentRegistry(\n  $taskId: String!\n  $projectId: String\n  $moduleId: String\n) {\n  refresh_task_document_registry(\n    task_id: $taskId\n    project_id: $projectId\n    module_id: $moduleId\n  ) {\n    id\n    relPath\n    contentDigest\n  }\n}\n\nmutation RefreshScratchDocumentRegistry($moduleId: String!) {\n  refresh_scratch_document_registry(module_id: $moduleId) {\n    id\n    relPath\n    contentDigest\n  }\n}\n\nquery CompleteDirectories($path: String!) {\n  directory_completions(path: $path)\n}";
const document = <TResult, TVariables>(
  operationName: string,
): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document",
  operationName,
  source,
});

export const RefreshTaskDocumentRegistryDocument = document<
  RefreshTaskDocumentRegistryMutation,
  RefreshTaskDocumentRegistryVariables
>("RefreshTaskDocumentRegistry");

export const RefreshScratchDocumentRegistryDocument = document<
  RefreshScratchDocumentRegistryMutation,
  RefreshScratchDocumentRegistryVariables
>("RefreshScratchDocumentRegistry");

export const CompleteDirectoriesDocument = document<
  CompleteDirectoriesQuery,
  CompleteDirectoriesVariables
>("CompleteDirectories");
