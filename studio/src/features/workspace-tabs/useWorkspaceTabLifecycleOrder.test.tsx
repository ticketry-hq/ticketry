import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceTabIdentity } from "./types";

const save = vi.hoisted(() => vi.fn(async () => ({ order: [] })));

vi.mock("./mutations", () => ({ saveWorkspaceTabOrder: save }));

import { useWorkspaceTabLifecycleOrder } from "./useWorkspaceTabLifecycleOrder";

describe("useWorkspaceTabLifecycleOrder", () => {
  afterEach(() => vi.clearAllMocks());

  it("appends new visible identities without removing dormant ones", async () => {
    const savedOrder: WorkspaceTabIdentity[] = [
      { kind: "terminal", id: "dormant" },
      { kind: "details" },
    ];
    const { rerender } = renderHook(
      ({ visible }: { visible: WorkspaceTabIdentity[] }) =>
        useWorkspaceTabLifecycleOrder({
          workItemId: "work-1",
          savedOrder,
          orderReady: true,
          visibleIdentities: visible,
        }),
      { initialProps: { visible: [{ kind: "details" }] } },
    );
    expect(save).not.toHaveBeenCalled();

    rerender({
      visible: [
        { kind: "details" },
        { kind: "doc", id: "design" },
      ],
    });

    await waitFor(() => expect(save).toHaveBeenCalledWith("work-1", [
      { kind: "terminal", id: "dormant" },
      { kind: "details" },
      { kind: "doc", id: "design" },
    ]));
  });

  it("waits until the saved order and identity catalogs are ready", () => {
    renderHook(() => useWorkspaceTabLifecycleOrder({
      workItemId: "work-1",
      savedOrder: [],
      orderReady: false,
      visibleIdentities: [{ kind: "details" }],
    }));
    expect(save).not.toHaveBeenCalled();
  });
});
