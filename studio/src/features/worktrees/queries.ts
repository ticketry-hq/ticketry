import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { listModuleWorktrees } from "./api";

export function useModuleWorktreesQuery(
  projectId: string,
  moduleId: string,
) {
  return useQuery(
    {
      queryKey: queryKeys.worktrees.byModule(projectId, moduleId),
      queryFn: ({ signal }) =>
        listModuleWorktrees(projectId, moduleId, signal),
      staleTime: 0,
    },
    queryClient,
  );
}
