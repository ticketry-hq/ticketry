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
  // Route writes before caching; rebuild derived accessors after Apollo copies a row.
  adapters?: {
    prepare: (state: T, previousState?: T) => void;
    derive: (state: T) => T;
  },
): ApolloStore<T> {
  const listeners = new Set<StateListener<T>>();
  const derived = new WeakMap<object, T>();
  const derive = (state: T): T => {
    if (!adapters) return state;
    const key = state as object;
    const existing = derived.get(key);
    if (existing) return existing;
    const value = adapters.derive(state);
    derived.set(key, value);
    return value;
  };
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
    if (record) return derive(record.value);
    write(initialState);
    return derive(initialState);
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
    adapters?.prepare(nextState, previousState);
    write(nextState);
    // Adapted stores expose derived fields on read wrappers. Legacy subscribers
    // still receive the mutable written value before Apollo copies it.
    for (const listener of listeners) listener(adapters ? getState() : nextState, previousState);
  };

  initialState = createState(setState, getState);
  adapters?.prepare(initialState);

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
