import type { ApolloClient } from "@apollo/client";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import {
  ModuleManagerArchivedModuleFieldsFragmentDoc,
  ModuleManagerArchivedModulesDocument,
  type ModuleManagerArchivedModuleFieldsFragment,
  type ModuleManagerArchivedModulesQueryVariables,
} from "./generated/archivedModules.documents";

export const ARCHIVED_MODULE_PAGE_SIZE = 100;

export function archivedModuleVariables(projectId: string, offset = 0): ModuleManagerArchivedModulesQueryVariables {
  return { projectId: compactWorktrackerId(projectId), offset, limit: ARCHIVED_MODULE_PAGE_SIZE };
}

/** Read the entire archive before normalizing; abandoned scope responses never enter Apollo. */
export async function readArchivedModules(client: ApolloClient, projectId: string, isCurrent: () => boolean): Promise<void> {
  const variables = archivedModuleVariables(projectId);
  const nodes: ModuleManagerArchivedModuleFieldsFragment[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let offset = 0;
  while (isCurrent()) {
    const result = await client.query({ query: ModuleManagerArchivedModulesDocument,
      variables: { ...variables, offset }, fetchPolicy: "no-cache", context: { queryDeduplication: false } });
    if (!isCurrent()) return;
    const page = result.data?.modules;
    const count = page?.paginationInfo?.total;
    if (!page || !Array.isArray(page.nodes) || page.nodes.length > ARCHIVED_MODULE_PAGE_SIZE
      || typeof page.pageInfo?.hasNextPage !== "boolean"
      || typeof count !== "number" || !Number.isInteger(count) || count < 0
      || (total !== undefined && total !== count)
      || page.nodes.some((module) => compactWorktrackerId(module.project_id) !== variables.projectId
        || !module.is_archived)) {
      throw new Error("Archived modules are unavailable. Retry to load the complete archive.");
    }
    total = count;
    for (const module of page.nodes) {
      const id = compactWorktrackerId(module.id);
      if (seen.has(id)) throw new Error("Archived modules changed while loading. Retry to load the complete archive.");
      seen.add(id);
      nodes.push(module);
    }
    offset += page.nodes.length;
    if (page.pageInfo.hasNextPage) {
      if (!page.nodes.length || offset >= count) {
        throw new Error("Archived module pagination is incomplete. Retry to load the archive.");
      }
      continue;
    }
    if (nodes.length !== count) throw new Error("Archived module pagination is incomplete. Retry to load the archive.");
    if (!isCurrent()) return;
    // A write can finish between pages. Recheck revisions immediately before
    // the atomic cache write, after the transport's ordinary revision guard.
    const currentNodes = nodes.map((module) => {
      const cached = client.cache.readFragment<Partial<ModuleManagerArchivedModuleFieldsFragment>>({
        id: client.cache.identify(module), fragment: ModuleManagerArchivedModuleFieldsFragmentDoc,
        returnPartialData: true, optimistic: false,
      });
      return cached && typeof cached.state_revision === "number" && cached.state_revision > module.state_revision
        ? { ...module, ...cached } : module;
    });
    client.writeQuery({ query: ModuleManagerArchivedModulesDocument, variables,
      data: { modules: { ...page, nodes: currentNodes } } });
    return;
  }
}
