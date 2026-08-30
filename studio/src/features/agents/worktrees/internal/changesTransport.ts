import { studioRuntime } from "../../../../runtime";
import { ModuleCheckoutCommitDocument } from "../generated/moduleCheckoutCommit.documents";
import { ModuleCheckoutCreatePullRequestDocument } from "../generated/moduleCheckoutCreatePullRequest.documents";
import { ModuleCheckoutPushDocument } from "../generated/moduleCheckoutPush.documents";
import { WorktreeCommitDocument } from "../generated/worktreeCommit.documents";
import { WorktreeCleanupDocument } from "../generated/worktreeCleanup.documents";
import type { WorktreeCleanupMutation } from "../generated/worktreeCleanup.documents";
import { WorktreeCreatePullRequestDocument } from "../generated/worktreeCreatePullRequest.documents";
import { WorktreeFollowUpPullRequestDocument } from "../generated/worktreeFollowUpPullRequest.documents";
import { WorktreeMergePreparationDocument } from "../generated/worktreeMergePreparation.documents";
import { WorktreePushDocument } from "../generated/worktreePush.documents";
import { WorktreeReplacePullRequestDocument } from "../generated/worktreeReplacePullRequest.documents";

export function commitTaskChanges(
  taskId: string,
  operationId: string,
  message: string,
): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      await execute(WorktreeCommitDocument, { taskId, operationId, message });
    },
  });
}

export function pushTaskChanges(taskId: string, operationId: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      await execute(WorktreePushDocument, { taskId, operationId });
    },
  });
}

export function cleanupTaskWorktree(
  taskId: string,
  operationId: string,
): Promise<WorktreeCleanupMutation["worktree_cleanup"]["status"]> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const result = await execute(WorktreeCleanupDocument, {
        taskId,
        operationId,
        confirmed: true,
      });
      return result.worktree_cleanup.status;
    },
  });
}

export function commitModuleChanges(
  moduleId: string,
  operationId: string,
  message: string,
): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      await execute(ModuleCheckoutCommitDocument, { moduleId, operationId, message });
    },
  });
}

export function pushModuleChanges(moduleId: string, operationId: string): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      await execute(ModuleCheckoutPushDocument, { moduleId, operationId });
    },
  });
}

export interface CreatedPullRequest {
  url: string;
}

export function createTaskPullRequest(
  taskId: string,
  operationId: string,
): Promise<CreatedPullRequest> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const result = await execute(WorktreeCreatePullRequestDocument, {
        taskId,
        operationId,
      });
      return { url: result.worktree_pull_request_create.url };
    },
  });
}

export function replaceTaskPullRequest(
  taskId: string,
  operationId: string,
): Promise<CreatedPullRequest> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const result = await execute(WorktreeReplacePullRequestDocument, {
        taskId,
        operationId,
      });
      return { url: result.worktree_pull_request_replace.url };
    },
  });
}

export function followUpTaskPullRequest(
  taskId: string,
  operationId: string,
): Promise<CreatedPullRequest> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const result = await execute(WorktreeFollowUpPullRequestDocument, {
        taskId,
        operationId,
      });
      return { url: result.worktree_pull_request_follow_up.url };
    },
  });
}

export function prepareTaskPullRequestMerge(
  taskId: string,
  operationId: string,
): Promise<void> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      await execute(WorktreeMergePreparationDocument, { taskId, operationId });
    },
  });
}

export function createModulePullRequest(
  moduleId: string,
  operationId: string,
): Promise<CreatedPullRequest> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      const result = await execute(ModuleCheckoutCreatePullRequestDocument, {
        moduleId,
        operationId,
      });
      return { url: result.module_checkout_pull_request_create.url };
    },
  });
}
