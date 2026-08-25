import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import type {
  Discard as DiscardResult,
  WorktreeRecord,
  WorktreeStatus as GeneratedWorktreeStatus,
} from "@worktracker/typescript-sdk/models";
import { apiBase, apiKey } from "../../../../shared/api/client";

export type WorktreeStatus = Omit<GeneratedWorktreeStatus, "kind"> & {
  kind: "worktree" | "no_repo" | "none";
};
export type { DiscardResult };

export const listWorktreeRecords = (
  moduleId: string,
  signal?: AbortSignal,
): Promise<WorktreeRecord[]> =>
  worktreesApi().worktreesRecordsList({ moduleId }, { signal });

export interface WorktreeContext {
  parentId?: string | null;
  moduleId?: string | null;
  projectId?: string | null;
  ticketSeq?: number | null;
  taskName?: string | null;
}

const worktreesApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).worktrees;

export const getWorktree = (
  taskId: string,
  ctx: WorktreeContext,
  signal?: AbortSignal,
) =>
  worktreesApi().worktreesRetrieve(
    {
      taskId,
      parentId: ctx.parentId ?? undefined,
      moduleId: ctx.moduleId ?? undefined,
    },
    { signal },
  ) as Promise<WorktreeStatus>;

export const createWorktree = (taskId: string, ctx: WorktreeContext) =>
  worktreesApi().worktreesCreateCreate({
    taskId,
    createWorktree: {
      parent_id: ctx.parentId ?? null,
      module_id: ctx.moduleId ?? null,
      project_id: ctx.projectId ?? null,
      ticket_seq: ctx.ticketSeq ?? null,
      task_name: ctx.taskName ?? null,
    },
  }) as Promise<WorktreeStatus>;

export const discardWorktree = (taskId: string, ctx: WorktreeContext) =>
  worktreesApi().worktreesDiscardCreate({
    taskId,
    parentId: ctx.parentId ?? undefined,
    moduleId: ctx.moduleId ?? undefined,
  });
