import { studioRuntime } from "../../runtime";
import * as rest from "./api/documentRestApi";
import { documentLabel } from "./documentLabel";
import {
  CompleteDirectoriesDocument,
  RefreshScratchDocumentRegistryDocument,
  RefreshTaskDocumentRegistryDocument,
  type DesignDocumentRow,
} from "./generated/documentRegistry";
import type { DesignDoc } from "./types";

/**
 * Studio's view of the document registry.
 *
 * A listing is a reconciliation: the runtime rescans the authorized design
 * directories, registers files written while it was not watching, prunes rows
 * whose file is gone, and returns the authoritative rows. Studio adapts those
 * generated model rows at this boundary — nothing downstream sees a GraphQL
 * shape, and no legacy REST envelope is preserved to get there.
 */

function adapt(rows: ReadonlyArray<DesignDocumentRow>): DesignDoc[] {
  return rows.map((row) => ({
    id: row.id,
    rel_path: row.relPath,
    label: documentLabel(row.relPath),
    content_digest: row.contentDigest ?? null,
  }));
}

export function listTaskDocuments(
  taskId: string,
  projectId?: string,
  moduleId?: string,
  signal?: AbortSignal,
): Promise<DesignDoc[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listTaskDocuments(taskId, projectId, moduleId, signal),
    graphQl: async (execute) => adapt(
      (await execute(RefreshTaskDocumentRegistryDocument, {
        taskId,
        projectId: projectId ?? null,
        moduleId: moduleId ?? null,
      })).refresh_task_document_registry,
    ),
  });
}

export function listScratchDocuments(
  moduleId: string,
  signal?: AbortSignal,
): Promise<DesignDoc[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listScratchDocuments(moduleId, signal),
    graphQl: async (execute) => adapt(
      (await execute(RefreshScratchDocumentRegistryDocument, { moduleId }))
        .refresh_scratch_document_registry,
    ),
  });
}

/**
 * Directory-name completion for the trusted local-folder field. It is a local
 * read rather than a workspace resource, so it never leaves the runtime.
 */
export function completeDirectories(
  path: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.completeDirectories(path, signal),
    graphQl: async (execute) => [
      ...(await execute(CompleteDirectoriesDocument, { path }))
        .directory_completions,
    ],
  });
}
