import { useQuery } from "@tanstack/react-query";
import {
  documentUrl,
  listScratchDocuments,
  listTaskDocuments,
  type DesignDoc,
} from "../../../../../features/documents";
import { queryClient } from "../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../shared/query/keys";

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
  const query = useQuery(
    {
      queryKey: scratch
        ? queryKeys.documents.registry("scratch", moduleId ?? "none", null, moduleId)
        : queryKeys.documents.registry("task", bucket ?? "none", projectId, moduleId),
      queryFn: ({ signal }) => scratch
        ? listScratchDocuments(moduleId!, signal)
        : listTaskDocuments(
          bucket!,
          projectId ?? undefined,
          moduleId ?? undefined,
          signal,
        ),
      enabled: bucket !== null && (!scratch || moduleId !== null),
      staleTime: 0,
    },
    queryClient,
  );
  return {
    documents: query.data ?? EMPTY_DOCUMENTS,
    isFetched: query.isFetched,
  };
}

export function loadDocumentContent(doc: DesignDoc): Promise<LoadedMarkdown> {
  const controller = new AbortController();
  return fetch(documentUrl(doc.id, doc.rel_path), {
    cache: "no-store",
    signal: controller.signal,
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
