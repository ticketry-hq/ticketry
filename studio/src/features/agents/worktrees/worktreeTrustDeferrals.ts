import { createApolloStore } from "../../../shared/apollo/localState";

interface WorktreeTrustDeferrals {
  pathsByTask: Record<string, string>;
  defer: (taskId: string, path: string) => void;
  clear: (taskId: string, path?: string) => void;
}

const worktreeTrustDeferrals = createApolloStore<WorktreeTrustDeferrals>(
  "worktree-trust-deferrals",
  (set, get) => ({
    pathsByTask: {},
    defer: (taskId, path) =>
      set((state) => ({
        pathsByTask: {
          ...state.pathsByTask,
          [taskId]: path,
        },
      })),
    clear: (taskId, path) => {
      const current = get().pathsByTask[taskId];
      if (current === undefined || (path !== undefined && current !== path)) {
        return;
      }
      set((state) => {
        const pathsByTask = { ...state.pathsByTask };
        delete pathsByTask[taskId];
        return { pathsByTask };
      });
    },
  }),
);

export function isWorktreeTrustDeferred(
  taskId: string,
  path: string,
): boolean {
  return worktreeTrustDeferrals.getState().pathsByTask[taskId] === path;
}

export function deferWorktreeTrust(taskId: string, path: string): void {
  worktreeTrustDeferrals.getState().defer(taskId, path);
}

export function clearWorktreeTrustDeferral(
  taskId: string,
  path?: string,
): void {
  worktreeTrustDeferrals.getState().clear(taskId, path);
}
