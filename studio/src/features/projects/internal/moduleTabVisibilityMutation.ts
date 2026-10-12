import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import type { ModulePresentation } from "../../../shared/api/types";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  UpdateWorkTrackerModulePresentationDocument,
  WorkTrackerProjectOpenDocument,
} from "../generated/projects.documents";

export interface ModuleTabVisibilityArgs {
  readonly projectId: string;
  readonly moduleId: string;
  readonly tabHidden: boolean;
  /** The module's current presentation rank, kept while the write is pending. */
  readonly rank: string;
}

/**
 * Show or hide one Module's tab. Presentations are not normalized, so the
 * membership update replaces the module's row in the project's open query;
 * the authoritative row is the whole change, and nothing else goes stale.
 */
export const moduleTabVisibilityMutation = declareMutation({
  document: UpdateWorkTrackerModulePresentationDocument,
  variables: ({ moduleId, tabHidden }: ModuleTabVisibilityArgs) => ({
    moduleId: compactWorktrackerId(moduleId),
    tabHidden,
  }),
  root: "update_module_presentation",
  optimistic: ({ moduleId, rank, tabHidden }) => ({
    __typename: "WorktrackerModulepresentation" as const,
    module_id: compactWorktrackerId(moduleId),
    rank,
    tab_hidden: tabHidden,
  }),
  membership: (cache, presentation, { projectId, moduleId }) => {
    const compactProjectId = compactWorktrackerId(projectId);
    const compactModuleId = compactWorktrackerId(moduleId);
    cache.updateQuery(
      { query: WorkTrackerProjectOpenDocument, variables: { projectId: compactProjectId } },
      (cached) => {
        if (!cached) return cached;
        const next = {
          ...presentation,
          module_id: compactModuleId,
          module: {
            __typename: "WorktrackerIssue" as const,
            id: compactModuleId,
            project_id: compactProjectId,
          },
        };
        let replaced = false;
        const nodes = cached.module_presentations.nodes.flatMap((row) => {
          if (compactWorktrackerId(row.module_id) !== compactModuleId) return [row];
          if (replaced) return [];
          replaced = true;
          return [next];
        });
        return {
          ...cached,
          module_presentations: {
            ...cached.module_presentations,
            nodes: replaced ? nodes : [...nodes, next],
          },
        };
      },
    );
  },
  result: (presentation): ModulePresentation => ({
    ...presentation,
    module_id: publicWorktrackerId(presentation.module_id),
  }),
});
