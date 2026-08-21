import { useCallback } from "react";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { apiErrorMessage } from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { toast } from "../../state/clientStore";
import { getModulesSnapshot } from "./queries";
import { planModuleReorder, type ModuleReorderPlan } from "./internal/moduleReorder";
import type { Module, ModulePresentation } from "../../shared/api/types";

interface ReorderModuleVariables {
  projectId: string;
  moduleId: string;
  plan: ModuleReorderPlan;
}

interface ReorderModuleContext {
  previous: Module[] | undefined;
}

export interface ModuleReorderControls {
  /** Persist a resolved drop. A no-op or unknown drop writes nothing. */
  reorder: (moduleId: string, targetId: string, intent: "near" | "far") => void;
  /** True while a reorder is in flight; drag sources stay disabled until it settles. */
  isPending: boolean;
}

/**
 * One in-flight reorder at a time, across every Module surface. The pending
 * flag is read from the mutation cache under this key rather than from one hook
 * instance, so the sidebar and the Module tab strip disable together instead of
 * each serializing only against its own gestures.
 */
const MODULE_REORDER_KEY = ["module-reorder"] as const;

/**
 * The one project-scoped Module reorder write (#360).
 *
 * Every part of the write is derived from the single cached Canonical module
 * order, so the sidebar and the Module tab strip cannot disagree about what a
 * drop means: the post-drop array is shown optimistically, the pre-drop array
 * is retained for rollback *and* sent as the possible first-drag baseline, and
 * the two neighbor ids are the server's ranking input.
 *
 * After settlement, the module list is refetched so the server's canonical
 * order replaces the optimistic array.
 */
export function useReorderModule(projectId: string | null): ModuleReorderControls {
  const isPending = useIsMutating({ mutationKey: MODULE_REORDER_KEY }, queryClient) > 0;
  const mutation = useMutation<
    ModulePresentation,
    Error,
    ReorderModuleVariables,
    ReorderModuleContext
  >(
    {
      mutationKey: MODULE_REORDER_KEY,
      mutationFn: ({ moduleId, plan }) =>
        api.reorderModulePresentation(moduleId, {
          before_id: plan.beforeId,
          after_id: plan.afterId,
          initial_order_ids: plan.initialOrderIds,
        }),

      async onMutate({ projectId: id, plan }) {
        const key = queryKeys.modules.byProject(id);
        await queryClient.cancelQueries({ queryKey: key, exact: true });
        const previous = queryClient.getQueryData<Module[]>(key);
        queryClient.setQueryData(key, plan.order);
        return { previous };
      },

      onError(error, { projectId: id }, context) {
        if (context?.previous !== undefined) {
          queryClient.setQueryData(queryKeys.modules.byProject(id), context.previous);
        }
        toast.error(`Modules could not be reordered: ${apiErrorMessage(error)}`);
      },

      async onSettled(_data, _error, { projectId: id }) {
        await queryClient.refetchQueries({
          queryKey: queryKeys.modules.byProject(id),
          exact: true,
        });
      },
    },
    queryClient,
  );

  const { mutate } = mutation;
  const reorder = useCallback(
    (moduleId: string, targetId: string, intent: "near" | "far") => {
      // A cancelled drag never reaches here, and a drop that changes nothing
      // must not become a write: both leave the persisted order alone.
      if (projectId === null || isPending) return;
      const plan = planModuleReorder(
        getModulesSnapshot(projectId),
        moduleId,
        targetId,
        intent,
      );
      if (plan === null) return;
      mutate({ projectId, moduleId, plan });
    },
    [isPending, mutate, projectId],
  );

  return { reorder, isPending };
}
