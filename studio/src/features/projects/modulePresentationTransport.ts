import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { publicResult, serverVariables } from "../../shared/api/worktrackerConversion";
import type { ModulePresentation } from "./modulePresentationTypes";
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
    variables: serverVariables(ReorderWorkTrackerModulePresentationDocument, {
      moduleId,
      beforeId: neighbors.before_id,
      afterId: neighbors.after_id,
      initialOrderIds: neighbors.initial_order_ids
        ? [...neighbors.initial_order_ids] : neighbors.initial_order_ids,
    }),
  });
  if (!data) throw new Error("Module reorder returned no data.");
  return publicResult(ReorderWorkTrackerModulePresentationDocument, data).reorder_module_presentation;
}

export async function setModuleTabHidden(
  projectId: string,
  moduleId: string,
  tabHidden: boolean,
): Promise<ModulePresentation> {
  const client = studioApolloClient();
  const variables = serverVariables(WorkTrackerProjectOpenDocument, { projectId });
  const mutationVariables = serverVariables(UpdateWorkTrackerModulePresentationDocument, {
    moduleId, tabHidden,
  });
  const compactModuleId = mutationVariables.moduleId;
  // Apollo optimistic/cache rows stay in server form; normalize legacy cache
  // identities only when matching a row, never feature results or wire inputs.
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
    variables: mutationVariables,
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
  return publicResult(UpdateWorkTrackerModulePresentationDocument, data).update_module_presentation;
}
