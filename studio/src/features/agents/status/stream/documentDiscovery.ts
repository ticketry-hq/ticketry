import { documentLabel, type DesignDoc } from "../../../documents";
import { scratchBucketId } from "../../terminal";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { useClientStore } from "../../../../state/clientStore";
import {
  ScratchDocumentRegistryDocument,
  TaskDocumentRegistryDocument,
  type ScratchDocumentRegistryQuery,
  type TaskDocumentRegistryQuery,
} from "../../../documents/generated/documentRegistry.documents";
import type { DocumentFact } from "./statusFacts";

export function applyCreatedDocumentFact(fact: DocumentFact): void {
  if (
    fact.removed ||
    fact.changeKind !== "created" ||
    !fact.documentId ||
    !fact.relPath ||
    (fact.scope === "scratch" && !fact.moduleId)
  ) {
    return;
  }
  const bucket = fact.scope === "scratch"
    ? scratchBucketId(fact.moduleId ?? "")
    : fact.ownerId;
  const document: DesignDoc = {
    id: fact.documentId,
    rel_path: fact.relPath,
    label: documentLabel(fact.relPath),
  };
  const row = {
    __typename: "DesignDocuments",
    id: document.id,
    relPath: document.rel_path,
    contentDigest: null,
  };
  const update = <T extends TaskDocumentRegistryQuery | ScratchDocumentRegistryQuery>(
    current: T | null,
  ): T | null => {
    if (!current) return current;
    const rows = current.document_registry.nodes;
    const index = rows.findIndex((item) => item.id === row.id);
    return {
      ...current,
      document_registry: {
        ...current.document_registry,
        nodes: index < 0
          ? [...rows, row]
          : rows.map((item, itemIndex) => itemIndex === index ? row : item),
      },
    } as T;
  };
  const client = studioApolloClient();
  if (fact.scope === "scratch" && fact.moduleId) {
    client.cache.updateQuery<ScratchDocumentRegistryQuery>(
      {
        query: ScratchDocumentRegistryDocument,
        variables: { moduleId: fact.moduleId },
      },
      update,
    );
  } else {
    client.cache.updateQuery<TaskDocumentRegistryQuery>(
      {
        query: TaskDocumentRegistryDocument,
        variables: { taskId: fact.ownerId },
      },
      update,
    );
  }
  const workspace = useClientStore.getState();
  workspace.ensureWorkspace(bucket);
  workspace.openDoc(bucket, document.id, true);
}
