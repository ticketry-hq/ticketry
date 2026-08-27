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
