import { useCallback, useSyncExternalStore } from "react";
import { apiErrorMessage } from "../../shared/api/errors";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { toast } from "../../state/clientStore";
import { reorderModulePresentation } from "./modulePresentationTransport";
import { WorkTrackerProjectOpenDocument } from "./generated/projects.documents";
import { planModuleReorder } from "./internal/moduleReorder";
import { getModulesSnapshot, loadModules, seedModules } from "./queries";

export interface ModuleReorderControls {
  reorder: (moduleId: string, targetId: string, intent: "near" | "far") => void;
  isPending: boolean;
}

let pendingCount = 0;
let optimisticSequence = 0;
const pendingListeners = new Set<() => void>();

function setPending(delta: number): void {
  pendingCount = Math.max(0, pendingCount + delta);
  pendingListeners.forEach((listener) => listener());
}

function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

function optimisticModuleOrder(projectId: string, order: readonly string[], layerId: string): void {
  const client = studioApolloClient();
  const variables = { projectId: compactWorktrackerId(projectId) };
  client.cache.batch({
    optimistic: layerId,
    update(cache) {
      cache.updateQuery({ query: WorkTrackerProjectOpenDocument, variables }, (current) => {
        if (!current) return current;
        const positions = new Map(order.map((id, index) => [compactWorktrackerId(id), index]));
        const existing = new Map(
          current.module_presentations.nodes.map((presentation) => [
            presentation.module_id,
            presentation,
          ]),
        );
        const orderedPresentations = order.map((id, index) => {
          const moduleId = compactWorktrackerId(id);
          const presentation = existing.get(moduleId);
          return {
            __typename: "WorktrackerModulepresentation" as const,
            module_id: moduleId,
            rank: String(index).padStart(8, "0"),
            tab_hidden: presentation?.tab_hidden ?? false,
            module: presentation?.module ?? {
              __typename: "WorktrackerIssue" as const,
              id: moduleId,
              project_id: variables.projectId,
            },
          };
        });
        const orderedIds = new Set(orderedPresentations.map((row) => row.module_id));
        return {
          ...current,
          modules: {
            ...current.modules,
            nodes: [...current.modules.nodes].sort((left, right) =>
              (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER)
              - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)
            ),
          },
          module_presentations: {
            ...current.module_presentations,
            nodes: [
              ...current.module_presentations.nodes.filter(
                (presentation) => !orderedIds.has(presentation.module_id),
              ),
              ...orderedPresentations,
            ],
          },
        };
      });
    },
  });
}

async function persistModuleReorder(
  projectId: string,
  moduleId: string,
  targetId: string,
  intent: "near" | "far",
  plan: NonNullable<ReturnType<typeof planModuleReorder>>,
): Promise<void> {
  const client = studioApolloClient();
  const layerId = `module-reorder:${++optimisticSequence}`;
  optimisticModuleOrder(projectId, plan.order.map((module) => module.id), layerId);
  setPending(1);
  let settledPlan = plan;
  try {
    try {
      await reorderModulePresentation(moduleId, {
        before_id: plan.beforeId,
        after_id: plan.afterId,
        initial_order_ids: plan.initialOrderIds,
      });
    } catch (error) {
      const message = apiErrorMessage(error);
      if (!message.includes("before/after are not ordered neighbors")) {
        toast.error(`Modules could not be reordered: ${message}`);
        return;
      }

      try {
        const authoritative = await loadModules(projectId, {
          queryDeduplication: false,
        });
        const retryPlan = planModuleReorder(
          authoritative,
          publicWorktrackerId(moduleId),
          publicWorktrackerId(targetId),
          intent,
        );
        if (!retryPlan) return;
        settledPlan = retryPlan;
        client.cache.removeOptimistic(layerId);
        optimisticModuleOrder(
          projectId,
          retryPlan.order.map((module) => module.id),
          layerId,
        );
        await reorderModulePresentation(moduleId, {
          before_id: retryPlan.beforeId,
          after_id: retryPlan.afterId,
          initial_order_ids: retryPlan.initialOrderIds,
        });
      } catch (retryError) {
        toast.error(
          `Modules could not be reordered: ${apiErrorMessage(retryError)}`,
        );
        return;
      }
    }
    try {
      await loadModules(projectId, { queryDeduplication: false });
    } catch {
      seedModules(projectId, settledPlan.order);
    }
  } finally {
    client.cache.removeOptimistic(layerId);
    setPending(-1);
  }
}

export function useReorderModule(projectId: string | null): ModuleReorderControls {
  const isPending = useSyncExternalStore(
    subscribePending,
    () => pendingCount > 0,
    () => false,
  );
  const reorder = useCallback(
    (moduleId: string, targetId: string, intent: "near" | "far") => {
      if (projectId === null || pendingCount > 0) return;
      const plan = planModuleReorder(
        getModulesSnapshot(projectId),
        publicWorktrackerId(moduleId),
        publicWorktrackerId(targetId),
        intent,
      );
      if (plan) {
        void persistModuleReorder(projectId, moduleId, targetId, intent, plan);
      }
    },
    [projectId],
  );
  return { reorder, isPending };
}
