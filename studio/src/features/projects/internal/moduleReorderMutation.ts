import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import type { ModulePresentation } from "../../../shared/api/types";
import { declareMutation, refreshRead } from "../../../shared/apollo/declaredMutation";
import {
  ReorderWorkTrackerModulePresentationDocument,
  WorkTrackerProjectOpenDocument,
} from "../generated/projects.documents";
import { applyModuleOrder, plannedModuleRank } from "./moduleOrderTransform";
import type { ModuleReorderPlan } from "./moduleReorder";

export interface ModuleReorderArgs {
  readonly projectId: string;
  readonly moduleId: string;
  readonly plan: ModuleReorderPlan;
}

const orderIds = (plan: ModuleReorderPlan) => plan.order.map((module) => module.id);
const compactOrNull = (id: string | null) => (id ? compactWorktrackerId(id) : null);

/**
 * Move one Module between its planned neighbours: every surface shows the
 * planned order at once, and the project's open query re-reads the server's.
 */
export const moduleReorderMutation = declareMutation({
  document: ReorderWorkTrackerModulePresentationDocument,
  variables: ({ moduleId, plan }: ModuleReorderArgs) => ({
    moduleId: compactWorktrackerId(moduleId),
    beforeId: compactOrNull(plan.beforeId),
    afterId: compactOrNull(plan.afterId),
    initialOrderIds: plan.initialOrderIds.map(compactWorktrackerId),
  }),
  root: "reorder_module_presentation",
  // Presentations are not normalized; this entity opens the optimistic layer
  // and the order transform below is what every surface shows.
  optimistic: ({ moduleId, plan }) => ({
    __typename: "WorktrackerModulepresentation" as const,
    module_id: compactWorktrackerId(moduleId),
    rank: plannedModuleRank(orderIds(plan).indexOf(moduleId)),
    tab_hidden: false,
  }),
  membership: (cache, _presentation, { projectId, plan }) =>
    applyModuleOrder(cache, projectId, orderIds(plan)),
  refresh: ({ projectId }) => [
    refreshRead(WorkTrackerProjectOpenDocument, {
      projectId: compactWorktrackerId(projectId),
    }),
  ],
  result: (presentation): ModulePresentation => ({
    ...presentation,
    module_id: publicWorktrackerId(presentation.module_id),
  }),
});
