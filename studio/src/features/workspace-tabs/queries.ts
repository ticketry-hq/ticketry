import { useQuery } from "@tanstack/react-query";
import * as api from "../../shared/api/client";
import { queryKeys } from "../../shared/query/keys";
import { queryClient } from "../../shared/query/queryClient";
import { workspaceTabOrderFromApi, type WorkspaceTabOrder } from "./types";

const EMPTY_ORDER: WorkspaceTabOrder = { order: [] };

const workspaceTabOrderQuery = (workItemId: string) => ({
  queryKey: queryKeys.workspaceTabs.byWorkItem(workItemId),
  queryFn: ({ signal }: { signal: AbortSignal }) => api
    .getWorkspaceTabOrder(workItemId, signal)
    .then(workspaceTabOrderFromApi),
  staleTime: 0,
});

export interface WorkspaceTabOrderQuery extends WorkspaceTabOrder {
  isReady: boolean;
}

export function useWorkspaceTabOrder(
  workItemId: string | null,
): WorkspaceTabOrderQuery {
  const query = useQuery(
    workItemId
      ? workspaceTabOrderQuery(workItemId)
      : {
          ...workspaceTabOrderQuery("none"),
          enabled: false,
        },
    queryClient,
  );
  return {
    ...(query.data ?? EMPTY_ORDER),
    isReady: query.isSuccess,
  };
}

export function loadWorkspaceTabOrder(
  workItemId: string,
): Promise<WorkspaceTabOrder> {
  return queryClient.ensureQueryData(workspaceTabOrderQuery(workItemId));
}
