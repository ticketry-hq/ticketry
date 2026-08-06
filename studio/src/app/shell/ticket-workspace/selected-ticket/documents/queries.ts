import type { DesignDoc, DocTabState } from "../../../../../features/agents/types";
import { getDocuments, getScratchDocuments } from "../../../../../features/agents/api/agentApi";
import { docUrl } from "../../../../../features/agents/api/agentApi";
import { queryClient } from "../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../shared/query/keys";

export interface LoadedMarkdown {
  digest: string;
  markdown: string;
}

export function loadTaskDocuments(
  taskId: string,
  projectId?: string,
  moduleId?: string,
): Promise<{ documents: DesignDoc[] }> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.documents.registry(
      "task",
      taskId,
      projectId,
      moduleId,
    ),
    queryFn: ({ signal }) =>
      getDocuments(taskId, projectId, moduleId, signal),
    staleTime: 0,
  });
}

export function loadScratchDocuments(
  moduleId: string,
): Promise<{ documents: DesignDoc[] }> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.documents.registry("scratch", moduleId, null, moduleId),
    queryFn: ({ signal }) => getScratchDocuments(moduleId, signal),
    staleTime: 0,
  });
}

export function loadDocumentContent(doc: DocTabState): Promise<LoadedMarkdown> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.documents.content(doc.docId, doc.relPath),
    queryFn: async ({ signal }) => {
      const response = await fetch(docUrl(doc.docId, doc.relPath), { signal });
      if (!response.ok) {
        throw new Error(`Document request failed: ${response.status}`);
      }
      const etag = response.headers.get("ETag") ?? "";
      return {
        digest: etag.replace(/^W\//, "").replace(/^\"|\"$/g, ""),
        markdown: await response.text(),
      };
    },
    staleTime: 0,
  });
}
