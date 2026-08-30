import { gql } from "@apollo/client";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { studioApolloClient } from "./client";

type StateChange<T> =
  | T
  | Partial<T>
  | ((state: T) => T | Partial<T>);

type SetState<T> = (change: StateChange<T>, replace?: boolean) => void;
type GetState<T> = () => T;
type StateCreator<T> = (set: SetState<T>, get: GetState<T>) => T;
type StateListener<T> = (state: T, previousState: T) => void;

export interface ApolloStore<T> {
  (): T;
  <Selected>(selector: (state: T) => Selected): Selected;
  getInitialState: () => T;
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: StateListener<T>) => () => void;
}

const LocalStateFragment = gql`
  fragment TicketryLocalStateValue on TicketryLocalState {
    id
    value
  }
`;

interface LocalStateRecord<T> {
  __typename: "TicketryLocalState";
  id: string;
  value: T;
}

/**
 * A selector facade whose only state is an Apollo cache row.
 *
 * Keeping this facade lets feature code retain focused selectors and
 * imperative actions while server records and client-only state share the one
 * application cache. The facade owns no snapshot of its own.
 */
export function createApolloStore<T>(
  id: string,
  createState: StateCreator<T>,
): ApolloStore<T> {
  const listeners = new Set<StateListener<T>>();
  let initialState: T;

  const cacheId = () =>
    studioApolloClient().cache.identify({
      __typename: "TicketryLocalState",
      id,
    });

  const write = (value: T): void => {
    studioApolloClient().cache.writeFragment<LocalStateRecord<T>>({
      id: cacheId(),
      fragment: LocalStateFragment,
      // Store hooks notify their own selectors below. Broadcasting this local
      // row write would also diff every unrelated server-record watcher.
      broadcast: false,
      data: {
        __typename: "TicketryLocalState",
        id,
        value,
      },
    });
  };

  const getState = (): T => {
    const record = studioApolloClient().cache.readFragment<LocalStateRecord<T>>({
      id: cacheId(),
      fragment: LocalStateFragment,
    });
    if (record) return record.value;
    write(initialState);
    return initialState;
  };

  const setState: SetState<T> = (change, replace = false) => {
    const previousState = getState();
    const changed =
      typeof change === "function"
        ? (change as (state: T) => T | Partial<T>)(previousState)
        : change;
    const nextState = replace
      ? (changed as T)
      : ({ ...previousState, ...changed } as T);
    if (Object.is(nextState, previousState)) return;
    write(nextState);
    // Notify with the written value before Apollo produces its immutable read
    // result. Existing subscribers may attach derived accessors to the value;
    // those accessors then become part of the cache row before React reads it.
    for (const listener of listeners) listener(nextState, previousState);
  };

  initialState = createState(setState, getState);

  const subscribe = (listener: StateListener<T>): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function useApolloStore(): T;
  function useApolloStore<Selected>(selector: (state: T) => Selected): Selected;
  function useApolloStore<Selected>(
    selector: (state: T) => Selected = (state) => state as unknown as Selected,
  ): Selected {
    const selected = useRef<{ state: T; selector: typeof selector; value: Selected }>();
    const getSelection = useCallback(() => {
      const state = getState();
      if (selected.current?.state === state && selected.current.selector === selector) {
        return selected.current.value;
      }
      const value = selector(state);
      if (selected.current && Object.is(selected.current.value, value)) {
        selected.current = { state, selector, value: selected.current.value };
        return selected.current.value;
      }
      selected.current = { state, selector, value };
      return value;
    }, [selector]);
    return useSyncExternalStore(subscribe, getSelection, getSelection);
  }

  return Object.assign(useApolloStore, {
    getInitialState: () => initialState,
    getState,
    setState,
    subscribe,
  });
}
