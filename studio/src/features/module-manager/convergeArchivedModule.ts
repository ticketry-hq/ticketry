import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { WorkTrackerModuleOpenDocument, type GeneratedWorkTrackerWorkItemFieldsFragment } from "../work-items";
import { ModuleManagerArchivedModulesDocument } from "./generated/archivedModules.documents";
import { invalidateModuleInspections } from "./inspectionInvalidation";
import { refreshArchivedDependencies } from "./refreshArchivedDependencies";
import { useArchivedReadMetadata, writeArchivedReadMetadata } from "./archivedReadMetadata";
import { archivedModuleVariables } from "./readArchivedModules";

/** Adopt committed membership before optional refreshes; failures cannot undo the archive. */
export function adoptArchivedModule(projectId: string, record: GeneratedWorkTrackerWorkItemFieldsFragment): void {
  const client = studioApolloClient();
  const same = (id: string) => compactWorktrackerId(id) === compactWorktrackerId(record.id);
  client.cache.batch({ update(cache) {
    // The committed server update archives this entire subtree. Adopt only
    // already-known descendants; preserve their actual server revisions.
    for (const [cacheId, cached] of Object.entries(cache.extract() as Record<string, unknown>)) {
      if (cached && typeof cached === "object" && "__typename" in cached && cached.__typename === "WorktrackerIssue"
        && "moduleId" in cached && typeof cached.moduleId === "string" && same(cached.moduleId)) {
        cache.modify({ id: cacheId, fields: { isArchived: () => true } });
      }
    }
    cache.updateQuery({ query: WorkTrackerProjectOpenDocument, variables: { projectId: compactWorktrackerId(projectId) } }, (current) => current ? {
      ...current, modules: { ...current.modules, nodes: current.modules.nodes.filter((row) => !same(row.id)) },
      module_presentations: { ...current.module_presentations, nodes: current.module_presentations.nodes.filter((row) => !same(row.module_id)) },
    } : current);
    cache.updateQuery({ query: WorkTrackerModuleOpenDocument, variables: { moduleId: compactWorktrackerId(record.id) } }, (current) =>
      current ? { ...current, work_items: { ...current.work_items, nodes: [] } } : current);
    cache.updateQuery({ query: ModuleManagerArchivedModulesDocument, variables: archivedModuleVariables(projectId) }, (current) => {
      const nodes = [...(current?.modules.nodes ?? []).filter((row) => !same(row.id)), {
        __typename: "WorktrackerIssue" as const, id: record.id, name: record.name, project_id: record.project_id,
        sequence_id: record.sequence_id, is_archived: true, issue_type: record.issue_type_id,
        state_revision: record.state_revision, project: record.project ? { __typename: "WorktrackerProject" as const, ...record.project } : null,
      }];
      return { modules: { __typename: "WorktrackerIssueConnection" as const, nodes,
        pageInfo: current?.modules.pageInfo ?? { __typename: "PageInfo" as const, hasNextPage: true },
        paginationInfo: current?.modules.paginationInfo ? { __typename: "PaginationInfo" as const,
          total: current.modules.pageInfo.hasNextPage
            ? current.modules.paginationInfo.total + (current.modules.nodes.some((row) => same(row.id)) ? 0 : 1) : nodes.length } : null } };
    });
  } });
}

export async function refreshArchivedModule(projectId: string, moduleId: string): Promise<void> {
  const results = await Promise.allSettled([
    refreshArchivedDependencies(projectId, [moduleId]), invalidateModuleInspections([projectId], [""]),
  ]);
  if (results.some((result) => result.status === "rejected")) {
    const scope = compactWorktrackerId(projectId);
    const previous = useArchivedReadMetadata.getState().projects[scope];
    writeArchivedReadMetadata(scope, { loading: false, refreshModuleIds: [...new Set([...(previous?.refreshModuleIds ?? []), moduleId])],
      error: previous?.error ?? "Module archived. Some affected lists could not refresh. Retry to refresh them without another archive write." });
  }
}
