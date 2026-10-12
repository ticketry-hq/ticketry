import { useCallback, useState, useSyncExternalStore } from "react";

import { createApolloStore, type ApolloStore } from "../localState";

interface PendingCount {
  readonly count: number;
}

const scopes = new Map<string, ApolloStore<PendingCount>>();

function scopeStore(scope: string): ApolloStore<PendingCount> {
  let store = scopes.get(scope);
  if (!store) {
    store = createApolloStore<PendingCount>(`mutation-pending:${scope}`, () => ({ count: 0 }));
    scopes.set(scope, store);
  }
  return store;
}

const noSubscription = () => () => undefined;

/**
 * The in-flight call count behind a mutation hook's `isPending`.
 *
 * Without a scope the count is the hook instance's own. With a scope it is an
 * Apollo local-state row, so every hook instance in that scope counts every
 * call in it: one surface's write keeps the others pending too.
 */
export function usePendingCount(scope: string | undefined) {
  const [localCount, setLocalCount] = useState(0);
  const store = scope === undefined ? undefined : scopeStore(scope);
  const sharedCount = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getState().count ?? 0,
  );
  const changePending = useCallback((delta: 1 | -1) => {
    const next = (count: number) => Math.max(0, count + delta);
    if (store) store.setState((state) => ({ count: next(state.count) }));
    else setLocalCount(next);
  }, [store]);
  return { isPending: (store ? sharedCount : localCount) > 0, changePending };
}
