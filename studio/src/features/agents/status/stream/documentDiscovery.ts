import { documentLabel, type DesignDoc } from "../../../documents";
import { scratchBucketId } from "../../terminal";
import { queryClient } from "../../../../shared/query/queryClient";
import { queryKeys } from "../../../../shared/query/keys";
import { useClientStore } from "../../../../state/clientStore";
import { useAgentStatusStore } from "../store";
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
  const registryKey = queryKeys.documents.registry(
    fact.scope,
    fact.ownerId,
    useAgentStatusStore.getState().projectId,
    fact.moduleId,
  );
  queryClient.setQueryData<DesignDoc[]>(registryKey, (current) => {
    const documents = current ?? [];
    const index = documents.findIndex((item) => item.id === document.id);
    return index < 0
      ? [...documents, document]
      : documents.map((item, itemIndex) => itemIndex === index ? document : item);
  });
  const workspace = useClientStore.getState();
  workspace.ensureWorkspace(bucket);
  workspace.openDoc(bucket, document.id, true);
}
