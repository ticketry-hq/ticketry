import { useQueries, useQuery } from "@tanstack/react-query";
import type { WorkItem } from "../../../shared/api/types";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import { workItemQuery } from "../../work-items/queries";
import {
  getWorktree,
  listWorktreeRecords,
  type WorktreeStatus,
} from "./internal/api";

const LIVE_STATUS_STALE_TIME = 30_000;

export interface ModuleWorktree {
  task: WorkItem;
  status: WorktreeStatus;
}

export function useModuleWorktrees(
  projectId: string | null,
  moduleId: string | null,
): {
  worktrees: ModuleWorktree[];
  loading: boolean;
  failed: boolean;
} {
  const records = useQuery(
    {
      queryKey: queryKeys.worktrees.records(moduleId ?? "no-module"),
      queryFn: ({ signal }) => listWorktreeRecords(moduleId!, signal),
      enabled: projectId !== null && moduleId !== null,
    },
    queryClient,
  );
  const taskIds = records.data?.map((record) => record.task_id) ?? [];
  const taskQueries = useQueries(
    { queries: taskIds.map((id) => workItemQuery(id)) },
    queryClient,
  );
  const tasks = taskQueries.flatMap(({ data }) => (data ? [data] : []));
  const statuses = useQueries(
    {
      queries: tasks.map((task) => ({
        queryKey: queryKeys.worktrees.status(
          task.id,
          task.parent_id,
          moduleId,
        ),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getWorktree(
            task.id,
            { parentId: task.parent_id, moduleId },
            signal,
          ),
        staleTime: LIVE_STATUS_STALE_TIME,
      })),
    },
    queryClient,
  );

  const worktrees = statuses.flatMap((query, index) => {
    const status = query.data;
    return status?.kind === "worktree"
      ? [{ task: tasks[index], status }]
      : [];
  });

  return {
    worktrees,
    loading:
      records.isPending ||
      taskQueries.some((query) => query.isPending) ||
      statuses.some((query) => query.isPending),
    failed:
      records.isError ||
      taskQueries.some((query) => query.isError) ||
      statuses.some((query) => query.isError),
  };
}

export async function invalidateTaskWorktree(taskId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.worktrees.byTask(taskId),
    }),
    queryClient.invalidateQueries({
      queryKey: [...queryKeys.worktrees.all, "records"],
    }),
  ]);
}
