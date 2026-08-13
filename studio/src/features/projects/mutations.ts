import { useCallback } from "react";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import { apiErrorMessage } from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { toast } from "../../state/clientStore";
import { getModulesSnapshot } from "./queries";
import { planModuleReorder, type ModuleReorderPlan } from "./internal/moduleReorder";
import { markManualModuleOrderAccepted } from "./internal/acceptedManualModuleOrder";
import type { Module, WorkItem } from "../../shared/api/types";
import { reorderWorkItem } from "../work-items";

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
 * After an accepted write, any projects request already in flight is cancelled
 * before the module list is refetched. That refetch revalidates the project's
 * durable ordering mode alongside the modules (#363, #479), and the mode read
 * must start after the write so a pre-reorder response cannot layer recency
 * back over the persisted Manual module order.
 */
export function useReorderModule(projectId: string | null): ModuleReorderControls {
  const isPending = useIsMutating({ mutationKey: MODULE_REORDER_KEY }, queryClient) > 0;
  const mutation = useMutation<
    WorkItem,
    Error,
    ReorderModuleVariables,
    ReorderModuleContext
  >(
    {
      mutationKey: MODULE_REORDER_KEY,
      mutationFn: ({ moduleId, plan }) =>
        reorderWorkItem(moduleId, {
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

      async onSuccess(_data, { projectId: id }) {
        // Accepting the write is what takes the project manual on the server.
        // Record that before the refetch, so a project read that fails during
        // it cannot answer "automatic" from the stale cache and drop recency
        // back over the order this drag just persisted (#367).
        markManualModuleOrderAccepted(id);

        // A projects read that departed before this acceptance cannot confirm
        // the mode it created. Retire it so the module refetch below starts a
        // post-reorder mode read instead of deduping onto the stale request.
        await queryClient.cancelQueries({
          queryKey: queryKeys.projects.all,
          exact: true,
        });
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
