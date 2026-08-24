import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { listModuleShipRecords, listTaskShipRecords } from "./api";

export function useTaskShipRecords(projectId: string, taskId: string) {
  return useQuery(
    {
      queryKey: queryKeys.shipRecords.byTask(projectId, taskId),
      queryFn: ({ signal }) => listTaskShipRecords(projectId, taskId, signal),
      staleTime: 0,
    },
    queryClient,
  );
}

export function useModuleShipRecordsQuery(
  projectId: string,
  moduleId: string,
) {
  return useQuery(
    {
      queryKey: queryKeys.shipRecords.byModule(projectId, moduleId),
      queryFn: ({ signal }) =>
        listModuleShipRecords(projectId, moduleId, signal),
      staleTime: 0,
    },
    queryClient,
  );
}
