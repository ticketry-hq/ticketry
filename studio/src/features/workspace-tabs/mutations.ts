import { useCallback } from "react";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { apiErrorMessage } from "../../shared/api/client";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { toast } from "../../state/clientStore";
import {
  workspaceTabOrderFromApi,
  workspaceTabOrderToApi,
  type WorkspaceTabIdentity,
  type WorkspaceTabOrder,
} from "./types";

const saveQueues = new Map<string, Promise<WorkspaceTabOrder>>();

export function saveWorkspaceTabOrder(
  workItemId: string,
  order: readonly WorkspaceTabIdentity[],
): Promise<WorkspaceTabOrder> {
  const previous = saveQueues.get(workItemId) ?? Promise.resolve({ order: [] });
  const request = previous
    .catch(() => ({ order: [] }))
    .then(() =>
      api.updateWorkspaceTabOrder(
        workItemId,
        workspaceTabOrderToApi({ order: [...order] }),
      ),
    )
    .then(workspaceTabOrderFromApi);
  saveQueues.set(workItemId, request);
  const clean = () => {
    if (saveQueues.get(workItemId) === request) saveQueues.delete(workItemId);
  };
  void request.then(clean, clean);
  return request;
}


const WORKSPACE_TAB_REORDER_KEY = ["workspace-tab-reorder"] as const;

interface ReorderVariables {
  workItemId: string;
  order: WorkspaceTabIdentity[];
  previousOrder: WorkspaceTabOrder;
}

interface ReorderContext {
  previous: WorkspaceTabOrder;
}

export function useReorderWorkspaceTabs(workItemId: string | null) {
  const isPending =
    useIsMutating({ mutationKey: WORKSPACE_TAB_REORDER_KEY }, queryClient) > 0;
  const mutation = useMutation<
    WorkspaceTabOrder,
    Error,
    ReorderVariables,
    ReorderContext
  >(
    {
      mutationKey: WORKSPACE_TAB_REORDER_KEY,
      mutationFn: ({ workItemId: id, order }) =>
        saveWorkspaceTabOrder(id, order),
      async onMutate({ workItemId: id, order, previousOrder }) {
        const key = queryKeys.workspaceTabs.byWorkItem(id);
        await queryClient.cancelQueries({ queryKey: key, exact: true });
        const previous =
          queryClient.getQueryData<WorkspaceTabOrder>(key) ?? previousOrder;
        queryClient.setQueryData<WorkspaceTabOrder>(key, { order });
        return { previous };
      },
      onSuccess(saved, { workItemId: id }) {
        queryClient.setQueryData(queryKeys.workspaceTabs.byWorkItem(id), saved);
      },
      onError(error, { workItemId: id }, context) {
        if (context) {
          queryClient.setQueryData(
            queryKeys.workspaceTabs.byWorkItem(id),
            context.previous,
          );
        }
        toast.error(`Workspace tabs could not be reordered: ${apiErrorMessage(error)}`);
      },
    },
    queryClient,
  );

  const { mutate } = mutation;
  const reorder = useCallback(
    (
      order: readonly WorkspaceTabIdentity[],
      previousOrder: WorkspaceTabOrder,
    ) => {
      if (workItemId === null || isPending) return false;
      mutate({ workItemId, order: [...order], previousOrder });
      return true;
    },
    [isPending, mutate, workItemId],
  );

  return { reorder, isPending };
}
