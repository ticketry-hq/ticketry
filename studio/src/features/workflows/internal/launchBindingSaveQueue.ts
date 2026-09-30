import { useEffect, useRef, useState } from "react";
import type { LaunchBindingInput } from "../../../shared/api/types";

type SaveLaunchBinding = (binding: LaunchBindingInput) => Promise<unknown>;

interface PendingSave {
  input: LaunchBindingInput;
  markSaved: (input: LaunchBindingInput) => void;
  save: SaveLaunchBinding;
}

interface BindingSaveQueue {
  pending: PendingSave | null;
  running: Promise<void> | null;
}

/**
 * Runs one launch-binding save at a time and retains only the newest queued
 * form state. A save includes its authoritative workflow refresh, so the next
 * write starts with the revision that refresh installed in Apollo.
 */
export function useLaunchBindingSaveQueue(
  identity: string,
  save: SaveLaunchBinding,
  markSaved: (input: LaunchBindingInput) => void,
): readonly [(input: LaunchBindingInput) => Promise<void>, boolean] {
  const queues = useRef(new Map<string, BindingSaveQueue>());
  const currentIdentity = useRef(identity);
  const mounted = useRef(false);
  const [applying, setApplying] = useState(false);
  currentIdentity.current = identity;

  useEffect(() => {
    mounted.current = true;
    setApplying(Boolean(queues.current.get(identity)?.running));
    return () => {
      mounted.current = false;
    };
  }, [identity]);

  const apply = (input: LaunchBindingInput): Promise<void> => {
    const scope = identity;
    let queue = queues.current.get(scope);
    if (!queue) {
      queue = { pending: null, running: null };
      queues.current.set(scope, queue);
    }
    queue.pending = { input, markSaved, save };
    if (queue.running) return queue.running;

    if (mounted.current && currentIdentity.current === scope) setApplying(true);
    const drain = async () => {
      let firstError: unknown;
      try {
        while (queue.pending) {
          const pending = queue.pending;
          queue.pending = null;
          try {
            const saved = await Promise.resolve().then(() =>
              pending.save(pending.input));
            if (saved !== null && currentIdentity.current === scope) {
              pending.markSaved(pending.input);
            }
          } catch (error) {
            firstError ??= error;
          }
        }
      } finally {
        // Clear `running` before this async drain settles. A promise reaction
        // can enqueue another edit after the loop observes `pending === null`;
        // clearing in `Promise.finally()` left that edit attached to an already
        // completed drain with nobody left to process it.
        queue.running = null;
        if (!queue.pending) queues.current.delete(scope);
        if (mounted.current && currentIdentity.current === scope) setApplying(false);
      }
      if (firstError !== undefined) throw firstError;
    };
    queue.running = drain();
    return queue.running;
  };

  return [apply, applying] as const;
}
