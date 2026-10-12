import { useEffect, useRef, useState } from "react";

/**
 * A save binding: sends one input and resolves with the authoritative saved
 * value. The binding owns transport and cache effects; sequencing owns order
 * and identity. Resolving `null` reports a write that did not land (for example
 * a revision conflict that reloaded the latest record), so nothing is marked
 * saved.
 */
export type SaveBinding<Input, Result> = (input: Input) => Promise<Result | null>;

export interface SaveCallbacks<Input, Result> {
  /** A save for the current identity landed. */
  onSaved: (identity: string, input: Input, result: Result) => void;
  /**
   * Saves for the current identity settled. `error` is the first failure;
   * `landed` is false when the last save resolved `null`.
   */
  onSettled: (identity: string, error: unknown, landed: boolean) => void;
}

/** Saves completing for a no-longer-current identity report nothing. */
function useIdentityScope(identity: string) {
  const currentIdentity = useRef(identity);
  const mounted = useRef(false);
  currentIdentity.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (scope: string) => mounted.current && currentIdentity.current === scope;
}

/**
 * Explicit commit: at most one save per identity runs at a time, and a request
 * while one runs is ignored, matching a disabled Save button.
 */
export function useExplicitCommit<Input, Result>(
  identity: string,
  save: SaveBinding<Input, Result>,
  callbacks: SaveCallbacks<Input, Result>,
): readonly [(input: Input) => Promise<void>, boolean] {
  const running = useRef(new Set<string>());
  const [runningIdentities, setRunningIdentities] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const isCurrent = useIdentityScope(identity);
  const latest = useRef(callbacks);
  latest.current = callbacks;

  const track = (scope: string, active: boolean) => {
    if (active) running.current.add(scope);
    else running.current.delete(scope);
    setRunningIdentities(new Set(running.current));
  };

  const commit = async (input: Input): Promise<void> => {
    const scope = identity;
    if (running.current.has(scope)) return;
    track(scope, true);
    let failure: unknown;
    let landed = false;
    try {
      const saved = await save(input);
      landed = saved !== null;
      if (saved !== null && isCurrent(scope)) {
        latest.current.onSaved(scope, input, saved);
      }
    } catch (error) {
      failure = error ?? new Error("Save failed");
    } finally {
      track(scope, false);
    }
    if (isCurrent(scope)) latest.current.onSettled(scope, failure, landed);
  };

  return [commit, runningIdentities.has(identity)] as const;
}

interface PendingSave<Input, Result> {
  input: Input;
  save: SaveBinding<Input, Result>;
}

interface SaveQueue<Input, Result> {
  pending: PendingSave<Input, Result> | null;
  running: Promise<void> | null;
}

/**
 * Autosave: runs one save at a time per identity and retains only the newest
 * queued input. A save includes its authoritative refresh, so the next write
 * starts with the revision that refresh installed in Apollo. The first error is
 * reported after the queue drains.
 */
export function useAutosaveQueue<Input, Result>(
  identity: string,
  save: SaveBinding<Input, Result>,
  callbacks: SaveCallbacks<Input, Result>,
): readonly [(input: Input) => Promise<void>, boolean] {
  const queues = useRef(new Map<string, SaveQueue<Input, Result>>());
  const [applying, setApplying] = useState(false);
  const isCurrent = useIdentityScope(identity);
  const latest = useRef(callbacks);
  latest.current = callbacks;

  useEffect(() => {
    setApplying(Boolean(queues.current.get(identity)?.running));
  }, [identity]);

  const apply = (input: Input): Promise<void> => {
    const scope = identity;
    let queue = queues.current.get(scope);
    if (!queue) {
      queue = { pending: null, running: null };
      queues.current.set(scope, queue);
    }
    queue.pending = { input, save };
    if (queue.running) return queue.running;

    if (isCurrent(scope)) setApplying(true);
    const drain = async () => {
      let firstError: unknown;
      let landed = false;
      try {
        while (queue.pending) {
          const pending = queue.pending;
          queue.pending = null;
          try {
            const saved = await Promise.resolve().then(() =>
              pending.save(pending.input));
            landed = saved !== null;
            if (saved !== null && isCurrent(scope)) {
              latest.current.onSaved(scope, pending.input, saved);
            }
          } catch (error) {
            landed = false;
            firstError ??= error ?? new Error("Save failed");
          }
        }
      } finally {
        // Clear `running` before this async drain settles. A promise reaction
        // can enqueue another edit after the loop observes `pending === null`;
        // clearing in `Promise.finally()` left that edit attached to an already
        // completed drain with nobody left to process it.
        queue.running = null;
        if (!queue.pending) queues.current.delete(scope);
        if (isCurrent(scope)) {
          setApplying(false);
          latest.current.onSettled(scope, firstError, landed);
        }
      }
      if (firstError !== undefined) throw firstError;
    };
    queue.running = drain();
    return queue.running;
  };

  return [apply, applying] as const;
}
