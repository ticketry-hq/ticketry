import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import type { ModulePresentation } from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  ReorderWorkTrackerModulePresentationDocument,
  UpdateWorkTrackerModulePresentationDocument,
  WorkTrackerProjectOpenDocument,
} from "./generated/projects.documents";

export async function reorderModulePresentation(
  moduleId: string,
  neighbors: {
    readonly before_id: string | null;
    readonly after_id: string | null;
    readonly initial_order_ids?: readonly string[] | null;
  },
): Promise<ModulePresentation> {
  const { data } = await studioApolloClient().mutate({
    mutation: ReorderWorkTrackerModulePresentationDocument,
    variables: {
      moduleId: compactWorktrackerId(moduleId),
      beforeId: neighbors.before_id ? compactWorktrackerId(neighbors.before_id) : null,
      afterId: neighbors.after_id ? compactWorktrackerId(neighbors.after_id) : null,
      initialOrderIds: neighbors.initial_order_ids?.map(compactWorktrackerId),
    },
  });
  if (!data) throw new Error("Module reorder returned no data.");
  return {
    ...data.reorder_module_presentation,
    module_id: publicWorktrackerId(data.reorder_module_presentation.module_id),
  };
}

export async function setModuleTabHidden(
  projectId: string,
  moduleId: string,
  tabHidden: boolean,
): Promise<ModulePresentation> {
  const client = studioApolloClient();
  const variables = { projectId: compactWorktrackerId(projectId) };
  const compactModuleId = compactWorktrackerId(moduleId);
  const current = client.readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables,
    optimistic: true,
  });
  const rank = current?.module_presentations.nodes.find(
    (presentation) =>
      compactWorktrackerId(presentation.module_id) === compactModuleId,
  )?.rank ?? "";
  const { data } = await client.mutate({
    mutation: UpdateWorkTrackerModulePresentationDocument,
    variables: { moduleId: compactModuleId, tabHidden },
    optimisticResponse: {
      update_module_presentation: {
        __typename: "WorktrackerModulepresentation",
        module_id: compactModuleId,
        rank,
        tab_hidden: tabHidden,
      },
    },
    update(cache, result) {
      const presentation = result.data?.update_module_presentation;
      if (!presentation) return;
      cache.updateQuery(
        { query: WorkTrackerProjectOpenDocument, variables },
        (cached) => {
          if (!cached) return cached;
          const next = {
            ...presentation,
            module_id: compactModuleId,
            module: {
              __typename: "WorktrackerIssue" as const,
              id: compactModuleId,
              project_id: variables.projectId,
            },
          };
          let replaced = false;
          const nodes = cached.module_presentations.nodes.flatMap((row) => {
            if (compactWorktrackerId(row.module_id) !== compactModuleId) {
              return [row];
            }
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
  });
  if (!data) throw new Error("Module visibility update returned no data.");
  return {
    ...data.update_module_presentation,
    module_id: publicWorktrackerId(data.update_module_presentation.module_id),
  };
}
