import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client/react";
import { documentLabel } from "./documentLabel";
import { documentUrl } from "./documentUrl";
import { listScratchDocuments, listTaskDocuments } from "./documentRegistry";
import type { DesignDoc } from "./types";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  ScratchDocumentRegistryDocument,
  TaskDocumentRegistryDocument,
  type ScratchDocumentRegistryQuery,
  type TaskDocumentRegistryQuery,
} from "./generated/documentRegistry.documents";
import { recordSelectionProfilePoint } from "../../shared/utilities/selectionProfile";

export interface LoadedMarkdown {
  digest: string;
  markdown: string;
}

const EMPTY_DOCUMENTS: DesignDoc[] = [];

export function useWorkspaceDocuments(
  bucket: string | null,
  projectId: string | null,
  moduleId: string | null,
  scratch: boolean,
): { documents: DesignDoc[]; isFetched: boolean } {
  const client = studioApolloClient();
  const ownerId = scratch ? moduleId : bucket;
  const registryKey = ownerId
    ? `${scratch ? "scratch" : "task"}:${ownerId}:${projectId ?? ""}:${moduleId ?? ""}`
    : null;
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReadyKey(null);
    if (!registryKey || !ownerId) return () => { active = false; };

    const refresh = scratch
      ? listScratchDocuments(ownerId)
      : listTaskDocuments(
        ownerId,
        projectId ?? undefined,
        moduleId ?? undefined,
      );
    recordSelectionProfilePoint("doc-registry-refresh:start");
    void refresh.then((documents) => {
      recordSelectionProfilePoint("doc-registry-refresh:end");
      const nodes = documents.map((document) => ({
        __typename: "DesignDocuments",
        id: document.id,
        relPath: document.rel_path,
        contentDigest: document.content_digest ?? null,
      }));
      if (scratch) {
        client.writeQuery<ScratchDocumentRegistryQuery>({
          query: ScratchDocumentRegistryDocument,
          variables: { moduleId: ownerId },
          data: {
            document_registry: {
              __typename: "DesignDocumentsConnection",
              nodes,
            },
          } as unknown as ScratchDocumentRegistryQuery,
        });
      } else {
        client.writeQuery<TaskDocumentRegistryQuery>({
          query: TaskDocumentRegistryDocument,
          variables: { taskId: ownerId },
          data: {
            document_registry: {
              __typename: "DesignDocumentsConnection",
              nodes,
            },
          } as unknown as TaskDocumentRegistryQuery,
        });
      }
      if (active) setReadyKey(registryKey);
    }).catch(() => {
      if (active) setReadyKey(registryKey);
    });
    return () => { active = false; };
  }, [client, moduleId, ownerId, projectId, registryKey, scratch]);

  const taskQuery = useQuery(
    TaskDocumentRegistryDocument,
    {
      client,
      variables: { taskId: bucket ?? "" },
      skip: scratch || !bucket || readyKey !== registryKey,
    },
  );
  const scratchQuery = useQuery(
    ScratchDocumentRegistryDocument,
    {
      client,
      variables: { moduleId: moduleId ?? "" },
      skip: !scratch || !moduleId || readyKey !== registryKey,
    },
  );
  const rows = scratch
    ? scratchQuery.data?.document_registry.nodes
    : taskQuery.data?.document_registry.nodes;
  const documents = useMemo(
    () => rows?.map((row) => ({
      id: row.id,
      rel_path: row.relPath,
      label: documentLabel(row.relPath),
      content_digest: row.contentDigest,
    })) ?? EMPTY_DOCUMENTS,
    [rows],
  );
  return {
    documents,
    isFetched: readyKey === registryKey
      && !(scratch ? scratchQuery.loading : taskQuery.loading),
  };
}

export function loadDocumentContent(
  doc: Pick<DesignDoc, "id" | "rel_path">,
  signal?: AbortSignal,
): Promise<LoadedMarkdown> {
  return fetch(documentUrl(doc.id, doc.rel_path), {
    cache: "no-store",
    signal,
  }).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`Document request failed: ${response.status}`);
      }
      const etag = response.headers.get("ETag") ?? "";
      return {
        digest: etag.replace(/^W\//, "").replace(/^\"|\"$/g, ""),
        markdown: await response.text(),
      };
    },
  );
}
