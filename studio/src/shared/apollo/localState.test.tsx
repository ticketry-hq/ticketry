import { gql } from "@apollo/client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { studioApolloClient } from "./client";
import { createApolloStore } from "./localState";

interface ProbeState {
  count: number;
  increment: () => void;
}

const useProbeStore = createApolloStore<ProbeState>("local-state-probe", (set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

describe("Apollo local state", () => {
  it("writes client-only state into the application cache", () => {
    useProbeStore.getState().increment();

    expect(studioApolloClient().cache.extract()).toMatchObject({
      'TicketryLocalState:{"id":"local-state-probe"}': {
        __typename: "TicketryLocalState",
        id: "local-state-probe",
        value: expect.objectContaining({ count: 1 }),
      },
    });
  });

  it("keeps selector hooks and imperative subscribers in step", () => {
    const listener = vi.fn();
    const unsubscribe = useProbeStore.subscribe(listener);
    const { result } = renderHook(() => useProbeStore((state) => state.count));

    act(() => useProbeStore.getState().increment());

    expect(result.current).toBe(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 0 }),
    );
    unsubscribe();
  });
});

it("keeps derived server fields live without storing a second server snapshot", () => {
  const query = gql`query AdapterProbe { probeCount }`;
  const client = studioApolloClient();
  client.writeQuery({ query, data: { probeCount: 1 } });
  const store = createApolloStore("adapter-probe", () => ({ selected: true, serverCount: 0 }), {
    prepare: (state) => {
      Object.defineProperty(state, "serverCount", { configurable: true, enumerable: false, value: 0 });
    },
    derive: (state) => Object.defineProperty({ ...state }, "serverCount", {
      get: () => client.readQuery<{ probeCount: number }>({ query })!.probeCount,
    }),
  });
  store.setState({ selected: false });
  const current = store.getState();
  expect(current.serverCount).toBe(1);
  expect(store.getState()).toBe(current);
  client.writeQuery({ query, data: { probeCount: 2 } });
  expect(store.getState().serverCount).toBe(2);
  const rows = client.cache.extract() as Record<string, { value: Record<string, unknown> }>;
  const stored = rows['TicketryLocalState:{"id":"adapter-probe"}'].value;
  expect(stored).toEqual({ selected: false });
});
