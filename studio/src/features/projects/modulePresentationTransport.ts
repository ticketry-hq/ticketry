import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import type { ModulePresentation } from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";
import { executeDeclaredMutation } from "../../shared/apollo/declaredMutation";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { moduleTabVisibilityMutation } from "./internal/moduleTabVisibilityMutation";

export function setModuleTabHidden(
  projectId: string,
  moduleId: string,
  tabHidden: boolean,
): Promise<ModulePresentation> {
  const compactModuleId = compactWorktrackerId(moduleId);
  const current = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  const rank = current?.module_presentations.nodes.find(
    (presentation) => compactWorktrackerId(presentation.module_id) === compactModuleId,
  )?.rank ?? "";
  return executeDeclaredMutation(moduleTabVisibilityMutation, {
    projectId, moduleId, tabHidden, rank,
  });
}
