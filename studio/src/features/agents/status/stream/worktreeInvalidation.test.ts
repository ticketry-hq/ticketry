import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserRuntime, initializeStudioRuntime } from "../../../../runtime";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { WorktreeStatusDocument } from "../../worktrees/generated/worktreeStatus.documents";
import {
  createWorktreeInvalidator,
  refreshWorktreeHoldings,
} from "./worktreeInvalidation";

afterEach(() => {
  vi.restoreAllMocks();
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

describe("converging worktree holdings through Apollo", () => {
  it("queues an Apollo refetch for the changed checkout owner", () => {
    const refetch = vi
      .spyOn(studioApolloClient(), "refetchQueries")
      .mockResolvedValue([]);
    const invalidator = createWorktreeInvalidator(50);

    invalidator.record("owner-1");
    invalidator.flush();

    expect(refetch).toHaveBeenCalledWith(expect.objectContaining({
      include: "active",
      onQueryUpdated: expect.any(Function),
    }));
  });

  it("refreshes every active worktree status query through Apollo", async () => {
    const refetch = vi
      .spyOn(studioApolloClient(), "refetchQueries")
      .mockResolvedValue([]);

    await refreshWorktreeHoldings();

    expect(refetch).toHaveBeenCalledWith({ include: [WorktreeStatusDocument] });
  });
});
