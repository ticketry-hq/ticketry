import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/// The document registry's authored operations. Generation fails when the
/// schema stops publishing one of them, so a renamed or removed field is a
/// build error rather than an empty workspace document list.
export async function generateDocumentOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "refresh_task_document_registry(task_id: String!, project_id: String, module_id: String): [DesignDocuments!]!",
    "refresh_scratch_document_registry(module_id: String!): [DesignDocuments!]!",
    "directory_completions(path: String!): [String!]!",
    "save_design_document(document_id: String!, expected_digest: String!, content: String!, operation_id: String!): DocumentSaveOutcome!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Documents schema is missing ${required}`);
    }
  }
  const source = (
    await readFile(
      join(sourceRoot, "features/documents/operations/documentRegistry.graphql"),
      "utf8",
    )
  ).trim();
  const target = join(outputRoot, "documents");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "documentRegistry.ts"),
    `// Generated from operations/documentRegistry.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

/**
 * One registered document, selected from the generated \`DesignDocuments\`
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

const source = ${JSON.stringify(source)};
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
`,
    "utf8",
  );
  await generateDocumentSave({ sourceRoot, target });
}

/// The digest-guarded save. Its outcome is data rather than an error even when
/// the document moved on, so the editor can keep the draft and offer a
/// deliberate retry against the version that is actually on disk.
async function generateDocumentSave({ sourceRoot, target }) {
  const source = (
    await readFile(
      join(sourceRoot, "features/documents/operations/documentSave.graphql"),
      "utf8",
    )
  ).trim();
  await writeFile(
    join(target, "documentSave.ts"),
    `// Generated from operations/documentSave.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

/**
 * What one save was answered with. \`stale\` means the file had already moved
 * on and was left untouched; \`digest\` is then the version it actually holds.
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

const source = ${JSON.stringify(source)};

export const SaveDesignDocumentDocument: TypedDocumentNode<
  SaveDesignDocumentMutation,
  SaveDesignDocumentVariables
> = {
  kind: "Document",
  operationName: "SaveDesignDocument",
  source,
};
`,
    "utf8",
  );
}
