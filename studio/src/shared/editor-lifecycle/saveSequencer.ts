import { useReducer, useRef } from "react";

/** One save attempt; resolves `true` when the write was applied. */
export type SaveRun = () => Promise<boolean>;

interface SaveQueue {
  pending: SaveRun | null;
  running: Promise<boolean> | null;
}

export interface SaveSequencer {
  /** Whether a save for the current identity is running. */
  saving: boolean;
  /** Whether `identity` is the one being edited now. */
  isCurrent: (identity: string) => boolean;
  /**
   * Autosave: runs saves for one identity one at a time and retains only the
   * newest queued run. Resolves after the queue drains with whether any write
   * was applied, or rejects with the first error once it has drained.
   */
  enqueueLatest: (identity: string, run: SaveRun) => Promise<boolean>;
  /** Explicit commit: starts `run` unless a save for `identity` is running. */
  runExclusive: (identity: string, run: SaveRun) => Promise<boolean> | null;
}

/**
 * Per-identity save ordering. A save includes the caller's authoritative
 * refresh, so a revision-guarded write that follows starts from the revision
 * the previous save installed in Apollo.
 */
export function useSaveSequencer(identity: string): SaveSequencer {
  const queues = useRef(new Map<string, SaveQueue>());
  const currentIdentity = useRef(identity);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  currentIdentity.current = identity;

  const enqueueLatest = (scope: string, run: SaveRun): Promise<boolean> => {
    let queue = queues.current.get(scope);
    if (!queue) {
      queue = { pending: null, running: null };
      queues.current.set(scope, queue);
    }
    queue.pending = run;
    if (queue.running) return queue.running;

    const drain = async (): Promise<boolean> => {
      let failed = false;
      let firstError: unknown;
      let applied = false;
      try {
        while (queue.pending) {
          const pending = queue.pending;
          queue.pending = null;
          try {
            if (await Promise.resolve().then(pending)) applied = true;
          } catch (error) {
            if (!failed) firstError = error;
            failed = true;
          }
        }
      } finally {
        // Clear `running` before this async drain settles. A promise reaction
        // can enqueue another edit after the loop observes `pending === null`;
        // clearing in `Promise.finally()` left that edit attached to an already
        // completed drain with nobody left to process it.
        queue.running = null;
        if (!queue.pending) queues.current.delete(scope);
        rerender();
      }
      if (failed) throw firstError;
      return applied;
    };
    queue.running = drain();
    rerender();
    return queue.running;
  };

  const runExclusive = (scope: string, run: SaveRun): Promise<boolean> | null =>
    queues.current.get(scope)?.running ? null : enqueueLatest(scope, run);

  return {
    saving: Boolean(queues.current.get(identity)?.running),
    isCurrent: (scope) => currentIdentity.current === scope,
    enqueueLatest,
    runExclusive,
  };
}
