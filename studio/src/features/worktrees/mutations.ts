import { useMutation } from "@tanstack/react-query";
import type { ShipRecord } from "@worktracker/typescript-sdk/models";
import { useRef } from "react";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { refreshShipRecordPullRequestState } from "./api";

interface RefreshVariables {
  projectId: string;
  moduleId: string;
  recordId: string;
}

export function useRefreshShipRecordPullRequestState(
  variables: RefreshVariables,
) {
  const requestStarted = useRef(false);
  const mutation = useMutation<ShipRecord, Error, void>(
    {
      mutationFn: () => refreshShipRecordPullRequestState(
        variables.projectId,
        variables.moduleId,
        variables.recordId,
      ),
      onSuccess: (updated) => {
        replaceCachedRecord(
          queryKeys.shipRecords.byModule(
            variables.projectId,
            variables.moduleId,
          ),
          updated,
        );
        if (updated.task_id) {
          replaceCachedRecord(
            queryKeys.shipRecords.byTask(variables.projectId, updated.task_id),
            updated,
          );
        }
      },
      onSettled: () => {
        requestStarted.current = false;
      },
    },
    queryClient,
  );

  return {
    ...mutation,
    refresh: () => {
      if (requestStarted.current) return;
      requestStarted.current = true;
      mutation.mutate();
    },
  };
}

function replaceCachedRecord(
  queryKey: readonly unknown[],
  updated: ShipRecord,
) {
  queryClient.setQueryData<ShipRecord[]>(queryKey, (current) =>
    current?.map((record) => record.id === updated.id ? updated : record),
  );
}
