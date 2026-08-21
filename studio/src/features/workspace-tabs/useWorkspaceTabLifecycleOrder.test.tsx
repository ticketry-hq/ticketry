import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { useWorkspaceTabLifecycleOrder } from "./useWorkspaceTabLifecycleOrder";
import type { WorkspaceTabIdentity } from "./types";

describe("useWorkspaceTabLifecycleOrder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
  });

  it("does not rerun the lifecycle work for a fresh equivalent identity array", () => {
    const workItemId = "work-1";
    const savedOrder: WorkspaceTabIdentity[] = [{ kind: "details" }];
    queryClient.setQueryData(queryKeys.workspaceTabs.byWorkItem(workItemId), {
      order: savedOrder,
    });
    const cacheReads = vi.spyOn(queryClient, "getQueryData");
    const { rerender } = renderHook(
      ({ visibleIdentities }: { visibleIdentities: WorkspaceTabIdentity[] }) =>
        useWorkspaceTabLifecycleOrder({
          workItemId,
          savedOrder,
          orderReady: true,
          visibleIdentities,
        }),
      { initialProps: { visibleIdentities: [{ kind: "details" }] } },
    );
    const readsAfterFirstEffect = cacheReads.mock.calls.length;

    rerender({ visibleIdentities: [{ kind: "details" }] });

    expect(cacheReads).toHaveBeenCalledTimes(readsAfterFirstEffect);
  });
});
