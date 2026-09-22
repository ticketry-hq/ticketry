import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItem } from "../../shared/api/types";
import { resetStudioApolloClient } from "../../shared/apollo/client";
import { TEMP_TASK_ID } from "../agents/types";
import { launchDefaultAgent } from "../agents/terminal";
import {
  deferWorktreeTrust,
  isWorktreeTrustDeferred,
} from "../agents/worktrees/worktreeTrustDeferrals";
import { executeTaskSubtree } from "../execution";
import { runWorkItem } from "./normalRun";

vi.mock("../agents/terminal", () => ({ launchDefaultAgent: vi.fn() }));
vi.mock("../execution", () => ({ executeTaskSubtree: vi.fn() }));

const item = (id: string, subIssues = 0) =>
  ({ id, sub_issues_count: subIssues } as WorkItem);

describe("normal work-item run", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => resetStudioApolloClient());

  it("rejects temporary items and routes branches and leaves to their existing launch commands", async () => {
    vi.mocked(executeTaskSubtree).mockResolvedValue({
      root_id: "branch-1",
      launched: ["child-1"],
    });
    const context = { projectId: "project-1", moduleId: "module-1" };

    await expect(runWorkItem(item(TEMP_TASK_ID))).rejects.toThrow(
      "Temporary work items cannot run.",
    );
    deferWorktreeTrust("branch-1", "/checkouts/branch-1");
    await expect(runWorkItem(item("branch-1", 1), context)).resolves.toEqual({
      kind: "subtree",
      launched: ["child-1"],
    });
    expect(
      isWorktreeTrustDeferred("branch-1", "/checkouts/branch-1"),
    ).toBe(false);
    expect(executeTaskSubtree).toHaveBeenCalledWith("branch-1");
    expect(launchDefaultAgent).not.toHaveBeenCalled();

    await expect(runWorkItem(item("leaf-1"), context)).resolves.toEqual({
      kind: "item",
    });
    expect(launchDefaultAgent).toHaveBeenCalledWith("leaf-1", context);
  });
});
