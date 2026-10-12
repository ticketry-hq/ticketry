import { useCallback } from "react";
import { apiErrorMessage } from "../../shared/api/errors";
import { publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import type { ModulePresentation } from "../../shared/api/types";
import {
  executeDeclaredMutation,
  mutationFailurePhase,
  useMutationState,
} from "../../shared/apollo/declaredMutation";
import { toast } from "../../state/clientStore";
import { planModuleReorder } from "./internal/moduleReorder";
import {
  moduleReorderMutation,
  type ModuleReorderArgs,
} from "./internal/moduleReorderMutation";
import { getModulesSnapshot, loadModules } from "./queries";

export interface ModuleReorderControls {
  reorder: (moduleId: string, targetId: string, intent: "near" | "far") => void;
  isPending: boolean;
}

interface ModuleReorderGesture extends ModuleReorderArgs {
  readonly targetId: string;
  readonly intent: "near" | "far";
}

const NOT_NEIGHBORS = "before/after are not ordered neighbors";

/**
 * Persist one Module drop. When the server says the planned neighbours are no
 * longer adjacent, the visible order was stale: re-plan the same gesture from
 * an authoritative read and send one new reorder with the new plan. The
 * committed-write path never re-sends.
 */
async function persistModuleReorder(
  gesture: ModuleReorderGesture,
): Promise<ModulePresentation | null> {
  try {
    return await executeDeclaredMutation(moduleReorderMutation, gesture);
  } catch (error) {
    if (
      mutationFailurePhase(error) !== "write"
      || !apiErrorMessage(error).includes(NOT_NEIGHBORS)
    ) {
      throw error;
    }
  }
  const authoritative = await loadModules(gesture.projectId, {
    queryDeduplication: false,
  });
  const plan = planModuleReorder(
    authoritative,
    publicWorktrackerId(gesture.moduleId),
    publicWorktrackerId(gesture.targetId),
    gesture.intent,
  );
  return plan
    ? executeDeclaredMutation(moduleReorderMutation, { ...gesture, plan })
    : null;
}

export function useReorderModule(projectId: string | null): ModuleReorderControls {
  // Every reorder surface shares one pending scope: a reorder in flight
  // disables dragging everywhere, not only where it started.
  const { mutateAsync, isPending } = useMutationState(
    persistModuleReorder,
    undefined,
    { pendingScope: "module-reorder" },
  );
  const reorder = useCallback(
    (moduleId: string, targetId: string, intent: "near" | "far") => {
      if (projectId === null || isPending) return;
      const plan = planModuleReorder(
        getModulesSnapshot(projectId),
        publicWorktrackerId(moduleId),
        publicWorktrackerId(targetId),
        intent,
      );
      if (!plan) return;
      void mutateAsync({ projectId, moduleId, targetId, intent, plan }).catch(
        (error: unknown) => {
          // A committed reorder whose project read failed keeps its order.
          if (mutationFailurePhase(error) === "refresh") return;
          toast.error(`Modules could not be reordered: ${apiErrorMessage(error)}`);
        },
      );
    },
    [isPending, mutateAsync, projectId],
  );
  return { reorder, isPending };
}
