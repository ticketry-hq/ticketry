import { queryKeys } from "../../../shared/query/keys";
import {
  getModuleChanges,
  getModuleFileDiff,
  getModulePushPreview,
  getWorktreeChanges,
  getWorktreeFileDiff,
  getWorktreePushPreview,
} from "../api";
import type {
  CheckoutRef,
  FileDiff,
  PushPreview,
  WorktreeChanges,
} from "../types";

/**
 * The one place a checkout identity becomes a cache key and a request.
 *
 * Both reads dispatch on the same `CheckoutRef`, so adding a checkout kind
 * cannot leave the key and the request disagreeing about which checkout is
 * being read.
 */
export function changesKey(checkout: CheckoutRef) {
  return checkout.kind === "module"
    ? queryKeys.sourceControl.moduleChanges(checkout.moduleId)
    : queryKeys.sourceControl.worktreeChanges(
        checkout.taskId,
        checkout.parentId,
        checkout.moduleId,
      );
}

export function fileDiffKey(checkout: CheckoutRef, path: string) {
  return checkout.kind === "module"
    ? queryKeys.sourceControl.moduleFileDiff(checkout.moduleId, path)
    : queryKeys.sourceControl.worktreeFileDiff(
        checkout.taskId,
        path,
        checkout.parentId,
        checkout.moduleId,
      );
}

export function readChanges(
  checkout: CheckoutRef,
  signal?: AbortSignal,
): Promise<WorktreeChanges> {
  return checkout.kind === "module"
    ? getModuleChanges(checkout.moduleId, signal)
    : getWorktreeChanges(
        checkout.taskId,
        { parentId: checkout.parentId, moduleId: checkout.moduleId },
        signal,
      );
}

export function readFileDiff(
  checkout: CheckoutRef,
  path: string,
  signal?: AbortSignal,
): Promise<FileDiff> {
  return checkout.kind === "module"
    ? getModuleFileDiff(checkout.moduleId, path, signal)
    : getWorktreeFileDiff(
        checkout.taskId,
        path,
        { parentId: checkout.parentId, moduleId: checkout.moduleId },
        signal,
      );
}

/**
 * The confirmation's key and read, for whichever checkout is being pushed.
 *
 * The key extends that checkout's change-set key on purpose: invalidating the
 * review invalidates the confirmation counted against it, and confirming a
 * push in one checkout can never spend the other's cached count.
 */
export function pushPreviewKey(checkout: CheckoutRef) {
  return checkout.kind === "module"
    ? queryKeys.sourceControl.modulePushPreview(checkout.moduleId)
    : queryKeys.sourceControl.worktreePushPreview(
        checkout.taskId,
        checkout.parentId,
        checkout.moduleId,
      );
}

export function readPushPreview(
  checkout: CheckoutRef,
  signal?: AbortSignal,
): Promise<PushPreview> {
  return checkout.kind === "module"
    ? getModulePushPreview(checkout.moduleId, signal)
    : getWorktreePushPreview(
        checkout.taskId,
        { parentId: checkout.parentId, moduleId: checkout.moduleId },
        signal,
      );
}
