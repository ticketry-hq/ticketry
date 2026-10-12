import { useCallback, useState } from "react";

import { usePendingCount } from "./pendingScope";

export interface MutationCallbacks<TResult> {
  onSuccess?: (data: TResult) => void;
  onError?: (error: Error) => void;
  onSettled?: (data: TResult | undefined, error: Error | null) => void;
}

/** Build the optimistic value from the feature's cached entity, if it has one. */
export interface OptimisticConstruction<TArgs, TEntity> {
  readonly current: (args: TArgs) => TEntity | undefined;
  readonly apply?: (current: TEntity, args: TArgs) => TEntity;
}

export interface MutationStateOptions {
  /** Hooks sharing a scope share one pending count across instances. */
  readonly pendingScope?: string;
}

/**
 * Pending, last-arguments, error and success state for one mutation entry.
 *
 * Pending is a count, so overlapping calls keep the hook pending until every
 * call settles. `mutateAsync` rethrows; `mutate` swallows the rejection after
 * the per-call `onError` and `onSettled` callbacks have run.
 */
export function useMutationState<TArgs, TResult, TOptimistic = never>(
  execute: (args: TArgs, optimistic: TOptimistic | undefined) => Promise<TResult>,
  optimistic?: OptimisticConstruction<TArgs, TOptimistic>,
  options: MutationStateOptions = {},
) {
  const { isPending, changePending } = usePendingCount(options.pendingScope);
  const [variables, setVariables] = useState<TArgs>();
  const [error, setError] = useState<Error | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const readCurrent = optimistic?.current;
  const apply = optimistic?.apply;

  const mutateAsync = useCallback(async (
    next: TArgs,
    callbacks: MutationCallbacks<TResult> = {},
  ): Promise<TResult> => {
    changePending(1);
    setVariables(next);
    setError(null);
    setIsSuccess(false);
    const current = readCurrent?.(next);
    const optimisticValue = current && apply ? apply(current, next) : undefined;
    try {
      const result = await execute(next, optimisticValue);
      setIsSuccess(true);
      callbacks.onSuccess?.(result);
      callbacks.onSettled?.(result, null);
      return result;
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      setError(failure);
      callbacks.onError?.(failure);
      callbacks.onSettled?.(undefined, failure);
      throw failure;
    } finally {
      changePending(-1);
    }
  }, [apply, changePending, execute, readCurrent]);

  const mutate = useCallback((
    next: TArgs,
    callbacks: MutationCallbacks<TResult> = {},
  ) => {
    void mutateAsync(next, callbacks).catch(() => undefined);
  }, [mutateAsync]);

  return {
    mutate,
    mutateAsync,
    isPending,
    variables,
    error,
    isError: error !== null,
    isSuccess,
  };
}
