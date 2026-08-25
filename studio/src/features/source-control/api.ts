import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { apiBase, apiKey } from "../../shared/api/client";
import type {
  CommitOutcome,
  CommitPushOutcome,
  FileDiff,
  PullRequestOutcome,
  PushPreview,
  WorktreeCheckoutRef,
  WorktreeChanges,
  WorktreeChangesContext,
} from "./types";

const sourceControlApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).sourceControl;

const worktreesApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).worktrees;

/** Everything the task's worktree currently changes against HEAD. */
export const getWorktreeChanges = (
  taskId: string,
  context: WorktreeChangesContext,
  signal?: AbortSignal,
) =>
  sourceControlApi().sourceControlWorktreeChangesRetrieve(
    {
      taskId,
      parentId: context.parentId ?? undefined,
      moduleId: context.moduleId ?? undefined,
    },
    { signal },
  ) as Promise<WorktreeChanges>;

/** The working-tree diff for one file the worktree is changing. */
export const getWorktreeFileDiff = (
  taskId: string,
  path: string,
  context: WorktreeChangesContext,
  signal?: AbortSignal,
) =>
  sourceControlApi().sourceControlWorktreeFileDiffRetrieve(
    {
      taskId,
      path,
      parentId: context.parentId ?? undefined,
      moduleId: context.moduleId ?? undefined,
    },
    { signal },
  ) as Promise<FileDiff>;

/** Confirmed cleanup for a merged task pull request. */
export const discardMergedWorktree = (checkout: WorktreeCheckoutRef) =>
  worktreesApi().worktreesDiscardCreate({
    taskId: checkout.taskId,
    parentId: checkout.parentId ?? undefined,
    moduleId: checkout.moduleId ?? undefined,
  });

/** Everything the module's base checkout currently changes against HEAD. */
export const getModuleChanges = (moduleId: string, signal?: AbortSignal) =>
  sourceControlApi().sourceControlModuleChangesRetrieve(
    { moduleId },
    { signal },
  ) as Promise<WorktreeChanges>;

/** The working-tree diff for one file the module's checkout is changing. */
export const getModuleFileDiff = (
  moduleId: string,
  path: string,
  signal?: AbortSignal,
) =>
  sourceControlApi().sourceControlModuleFileDiffRetrieve(
    { moduleId, path },
    { signal },
  ) as Promise<FileDiff>;

/**
 * Commit every change in the task's worktree.
 *
 * No path list crosses the wire: the action takes the whole change set, so
 * the only thing this call chooses is the checkout.
 */
export const commitWorktreeChanges = (
  taskId: string,
  context: WorktreeChangesContext,
) =>
  sourceControlApi().sourceControlWorktreeCommitCreate({
    worktreeCommitRequest: {
      task_id: taskId,
      parent_id: context.parentId ?? undefined,
      module_id: context.moduleId ?? undefined,
    },
  }) as Promise<CommitOutcome>;

/**
 * What the commit-and-push action would send, before it sends anything.
 *
 * Read on demand when the confirmation opens rather than kept fresh: it probes
 * the remote, and a number that was true a minute ago is worse than one
 * fetched at the moment the user is deciding.
 */
export const getWorktreePushPreview = (
  taskId: string,
  context: WorktreeChangesContext,
  signal?: AbortSignal,
) =>
  sourceControlApi().sourceControlWorktreePushPreviewRetrieve(
    {
      taskId,
      parentId: context.parentId ?? undefined,
      moduleId: context.moduleId ?? undefined,
    },
    { signal },
  ) as Promise<PushPreview>;

/**
 * Commit every change in the task's worktree, then publish its branch.
 *
 * The request carries the checkout and nothing else. There is no remote to
 * choose and no force to set: the push publishes the current branch to the
 * remote that branch is configured for, or it refuses.
 */
export const commitAndPushWorktreeChanges = (
  taskId: string,
  context: WorktreeChangesContext,
) =>
  sourceControlApi().sourceControlWorktreeCommitPushCreate({
    worktreeActionRequest: {
      task_id: taskId,
      parent_id: context.parentId ?? undefined,
      module_id: context.moduleId ?? undefined,
    },
  }) as Promise<CommitPushOutcome>;

/**
 * Commit every change, publish the branch, then open the pull request.
 *
 * The whole stack in one request. There is no title, body, base branch, or
 * reviewer list to send: the text is generated inside the action and the base
 * is resolved from the repository, so nothing the client sends could disagree
 * with what the pull request ends up saying.
 */
export const commitPushAndOpenPullRequest = (
  taskId: string,
  context: WorktreeChangesContext,
) =>
  sourceControlApi().sourceControlWorktreeCommitPushPrCreate({
    worktreePullRequestRequest: {
      task_id: taskId,
      parent_id: context.parentId ?? undefined,
      module_id: context.moduleId ?? undefined,
    },
  }) as Promise<PullRequestOutcome>;

/**
 * Open the pull request for a branch that is already committed and pushed.
 *
 * The retry after a provider failure. Re-running the whole stack to reach one
 * remaining step would work, but this says what the user actually wants, and
 * the backend refuses it if the tree has changed since.
 */
export const openPullRequest = (
  taskId: string,
  context: WorktreeChangesContext,
) =>
  sourceControlApi().sourceControlWorktreePullRequestCreate({
    worktreePullRequestRequest: {
      task_id: taskId,
      parent_id: context.parentId ?? undefined,
      module_id: context.moduleId ?? undefined,
    },
  }) as Promise<PullRequestOutcome>;

/**
 * Commit every change in the module's base checkout.
 *
 * The module spelling of the same action. It names a module instead of a task
 * and carries nothing else — no path list, and no way to reach a worktree.
 */
export const commitModuleChanges = (moduleId: string) =>
  sourceControlApi().sourceControlModuleCommitCreate({
    moduleCommitRequest: { module_id: moduleId },
  }) as Promise<CommitOutcome>;

/** What the module checkout's commit-and-push action would send. */
export const getModulePushPreview = (
  moduleId: string,
  signal?: AbortSignal,
) =>
  sourceControlApi().sourceControlModulePushPreviewRetrieve(
    { moduleId },
    { signal },
  ) as Promise<PushPreview>;

/**
 * Commit every change in the module's base checkout, then publish its branch.
 *
 * The module checkout's terminal action: a base checkout normally sits on the
 * default branch, where a pull request is refused, so this is the whole flow
 * rather than a shorter stop on the way to one.
 */
export const commitAndPushModuleChanges = (moduleId: string) =>
  sourceControlApi().sourceControlModuleCommitPushCreate({
    moduleActionRequest: { module_id: moduleId },
  }) as Promise<CommitPushOutcome>;

/** Commit, publish, then open the pull request — from the module checkout. */
export const commitPushAndOpenModulePullRequest = (moduleId: string) =>
  sourceControlApi().sourceControlModuleCommitPushPrCreate({
    modulePullRequestRequest: { module_id: moduleId },
  }) as Promise<PullRequestOutcome>;

/** Open the module checkout's pull request alone, after a provider failure. */
export const openModulePullRequest = (moduleId: string) =>
  sourceControlApi().sourceControlModulePullRequestCreate({
    modulePullRequestRequest: { module_id: moduleId },
  }) as Promise<PullRequestOutcome>;
