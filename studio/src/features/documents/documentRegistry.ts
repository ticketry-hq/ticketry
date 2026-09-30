import { studioApolloClient } from "../../shared/apollo/client";
import { documentLabel } from "./documentLabel";
import {
  CompleteDirectoriesDocument,
  RefreshScratchDocumentRegistryDocument,
  RefreshTaskDocumentRegistryDocument,
} from "./generated/documentRegistry.documents";
import type { RefreshTaskDocumentRegistryMutation } from "./generated/documentRegistry.documents";
import type { DesignDoc } from "./types";

type DesignDocumentRow = RefreshTaskDocumentRegistryMutation[
  "refresh_task_document_registry"
][number];

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
  void signal;
  return studioApolloClient()
    .mutate({
      mutation: RefreshTaskDocumentRegistryDocument,
      variables: {
        taskId,
        projectId: projectId ?? null,
        moduleId: moduleId ?? null,
      },
    })
    .then((result) => {
      if (!result.data) throw new Error("Task document registry returned no data.");
      return adapt(result.data.refresh_task_document_registry);
    });
}

export function listScratchDocuments(
  moduleId: string,
  signal?: AbortSignal,
): Promise<DesignDoc[]> {
  void signal;
  return studioApolloClient()
    .mutate({
      mutation: RefreshScratchDocumentRegistryDocument,
      variables: { moduleId },
    })
    .then((result) => {
      if (!result.data) throw new Error("Scratch document registry returned no data.");
      return adapt(result.data.refresh_scratch_document_registry);
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
  void signal;
  return studioApolloClient()
    .query({
      query: CompleteDirectoriesDocument,
      variables: { path },
      fetchPolicy: "network-only",
    })
    .then((result) => {
      if (!result.data) throw new Error("Directory completion returned no data.");
      return [...result.data.directory_completions];
    });
}
