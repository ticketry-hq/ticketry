import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { listModuleShipRecords, listTaskShipRecords } from "./api";
import {
  changesKey,
  fileDiffKey,
  pushPreviewKey,
  readChanges,
  readFileDiff,
  readPushPreview,
} from "./internal/checkoutReads";
import type {
  CheckoutRef,
  FileDiff,
  PushPreview,
  WorktreeChanges,
  WorktreeChangesContext,
} from "./types";
import { worktreeCheckout } from "./types";

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

/**
 * One checkout's change set.
 *
 * v1 reads status on demand rather than streaming it: the query loads when
 * the reviewing surface mounts, refetches when the reviewer asks, and is
 * invalidated by any mutation that touches that checkout. Nothing polls.
 */
export function useCheckoutChanges(checkout: CheckoutRef | null) {
  return useQuery(
    {
      queryKey: checkout
        ? changesKey(checkout)
        : ["source-control", "changes", "none"],
      queryFn: ({ signal }) => readChanges(checkout as CheckoutRef, signal),
      enabled: checkout !== null,
      // Opening the Changes tab is the deliberate trigger for both the local
      // checkout read and the recorded pull request's provider verdict.
      staleTime: 15_000,
      refetchOnMount: "always",
      retry: false,
    },
    queryClient,
  );
}

/** The working-tree diff for the selected file, fetched only once selected. */
export function useCheckoutFileDiff(
  checkout: CheckoutRef | null,
  path: string | null,
) {
  return useQuery(
    {
      queryKey:
        checkout && path
          ? fileDiffKey(checkout, path)
          : ["source-control", "changes", "none", "file-diff"],
      queryFn: ({ signal }) =>
        readFileDiff(checkout as CheckoutRef, path as string, signal),
      enabled: checkout !== null && Boolean(path),
      staleTime: 15_000,
      retry: false,
    },
    queryClient,
  );
}

/**
 * What the commit-and-push action would send, read only once it is asked for.
 *
 * `enabled` is the confirmation being open. The read probes the remote, so it
 * must not run on mount for every reviewer who never intends to push — and it
 * must not be served from a long-lived cache either, because the number the
 * user is agreeing to has to be the number that is true now.
 */
export function usePushPreview(checkout: CheckoutRef, enabled: boolean) {
  return useQuery(
    {
      queryKey: pushPreviewKey(checkout),
      queryFn: ({ signal }) => readPushPreview(checkout, signal),
      enabled,
      staleTime: 0,
      // A confirmation that silently re-probes under the user's cursor would
      // change the count they are looking at.
      refetchOnMount: "always",
      retry: false,
    },
    queryClient,
  );
}

export function seedPushPreview(
  checkout: CheckoutRef,
  preview: PushPreview,
): void {
  queryClient.setQueryData(pushPreviewKey(checkout), preview);
}

/**
 * Drop the cached review for one checkout.
 *
 * Every mutation that can change that working tree calls this on success. The
 * per-file diff keys and the push confirmation's key both extend the
 * change-set key, so one call clears all three — and because the key carries
 * the checkout kind, invalidating a task worktree leaves the module base
 * checkout's review alone.
 */
export function invalidateCheckoutChanges(
  checkout: CheckoutRef,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: changesKey(checkout) });
}

export function seedCheckoutChanges(
  checkout: CheckoutRef,
  changes: WorktreeChanges,
): void {
  queryClient.setQueryData(changesKey(checkout), changes);
}

export function seedCheckoutFileDiff(
  checkout: CheckoutRef,
  path: string,
  diff: FileDiff,
): void {
  queryClient.setQueryData(fileDiffKey(checkout, path), diff);
}

/** Task-worktree spellings of the reads above, kept for existing callers. */
export function useWorktreeChanges(
  taskId: string | null,
  context: WorktreeChangesContext,
) {
  return useCheckoutChanges(taskId ? worktreeCheckout(taskId, context) : null);
}

export function useWorktreeFileDiff(
  taskId: string | null,
  path: string | null,
  context: WorktreeChangesContext,
) {
  return useCheckoutFileDiff(
    taskId ? worktreeCheckout(taskId, context) : null,
    path,
  );
}

export function invalidateWorktreeChanges(
  taskId: string,
  context: WorktreeChangesContext = {},
): Promise<void> {
  return invalidateCheckoutChanges(worktreeCheckout(taskId, context));
}

export function seedWorktreeChanges(
  taskId: string,
  context: WorktreeChangesContext,
  changes: WorktreeChanges,
): void {
  seedCheckoutChanges(worktreeCheckout(taskId, context), changes);
}

export function seedWorktreeFileDiff(
  taskId: string,
  path: string,
  context: WorktreeChangesContext,
  diff: FileDiff,
): void {
  seedCheckoutFileDiff(worktreeCheckout(taskId, context), path, diff);
}
