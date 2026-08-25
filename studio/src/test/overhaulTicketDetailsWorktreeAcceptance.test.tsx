import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as worktreesApi from "../features/agents/worktrees/internal/api";
import type { WorktreeStatus } from "../features/agents/worktrees/internal/api";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const ownerTaskId = "7f3c1e02-1111-4222-8333-123456789abc";

const topLevelNone: WorktreeStatus = {
  kind: "none",
  task_id: ownerTaskId,
  top_level_task_id: ownerTaskId,
  is_shared: false,
};

const dirtyWorktree: WorktreeStatus = {
  kind: "worktree",
  task_id: ownerTaskId,
  top_level_task_id: ownerTaskId,
  is_shared: false,
  branch: "ticket/T-1002-worktree-details",
  base_branch: "main",
  path: "/tmp/ticketry-worktrees/T-1002",
  state: "active",
  clean: false,
  dirty: true,
  ahead: 3,
  behind: 1,
  conflict: false,
};

const conflictWorktree: WorktreeStatus = {
  ...dirtyWorktree,
  task_id: "conflicted",
  top_level_task_id: "conflicted",
  branch: "ticket/T-1003-conflicted",
  state: "conflict",
  conflict: true,
};

const sharedWorktree: WorktreeStatus = {
  ...dirtyWorktree,
  task_id: "subtask",
  top_level_task_id: ownerTaskId,
  is_shared: true,
};

describe("overhaul acceptance — ticket-details worktrees", () => {
  it("[overhaul-205] manages a top-level worktree and explains shared work on a subtask", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [ownerTaskId, "conflicted"],
      children: {
        [ownerTaskId]: ["subtask"],
        subtask: [],
        conflicted: [],
      },
      order: [ownerTaskId, "subtask", "conflicted"],
    });
    http.workItems([
      workItem({
        id: ownerTaskId,
        name: "Top-level task",
        key: "CODING-1002",
        sequence_id: 1002,
        parent_id: "module-1",
        sub_issues_count: 1,
      }),
      workItem({
        id: "subtask",
        name: "Shared subtask",
        sequence_id: 1004,
        parent_id: ownerTaskId,
      }),
      workItem({
        id: "conflicted",
        name: "Conflicted task",
        sequence_id: 1003,
        parent_id: "module-1",
      }),
    ]);

    let topLevelStatus = topLevelNone;
    vi.spyOn(worktreesApi, "getWorktree").mockImplementation(async (taskId) => {
      if (taskId === "subtask") return sharedWorktree;
      if (taskId === "conflicted") return conflictWorktree;
      return topLevelStatus;
    });
    const create = vi
      .spyOn(worktreesApi, "createWorktree")
      .mockImplementation(async () => {
        topLevelStatus = dirtyWorktree;
        return dirtyWorktree;
      });
    const discard = vi
      .spyOn(worktreesApi, "discardWorktree")
      .mockImplementation(async () => {
        topLevelStatus = topLevelNone;
        return { removed: true, reason: "" };
      });

    mountStudio({ http, selectedTaskId: ownerTaskId });
    const details = await screen.findByRole("region", { name: "Details" });
    const worktree = await within(details).findByTestId("worktree-block");

    fireEvent.click(
      within(worktree).getByRole("button", { name: "+ Create worktree" }),
    );
    expect(
      await within(worktree).findByText(
        "ticket/T-1002-worktree-details → main",
      ),
    ).toBeVisible();
    expect(within(worktree).getByText("dirty")).toBeVisible();
    expect(within(worktree).getByText("↑3")).toBeVisible();
    expect(within(worktree).getByText("↓1")).toBeVisible();
    expect(create).toHaveBeenCalledWith(
      ownerTaskId,
      expect.objectContaining({
        parentId: "module-1",
        moduleId: "module-1",
        projectId: "project-1",
        ticketSeq: 1002,
        taskName: "Top-level task",
      }),
    );

    fireEvent.click(within(worktree).getByRole("button", { name: "Discard" }));
    expect(discard).not.toHaveBeenCalled();
    expect(worktree).toHaveTextContent(
      "Discard this dirty worktree? Uncommitted changes will be lost.",
    );
    fireEvent.click(within(worktree).getByRole("button", { name: "Cancel" }));
    expect(discard).not.toHaveBeenCalled();
    fireEvent.click(within(worktree).getByRole("button", { name: "Discard" }));
    fireEvent.click(
      within(worktree).getByRole("button", { name: "Yes, discard" }),
    );
    await within(worktree).findByRole("button", { name: "+ Create worktree" });
    expect(discard).toHaveBeenCalledTimes(1);

    act(() => useClientStore.getState().selectTask("conflicted"));
    const conflicted = await within(details).findByTestId("worktree-block");
    expect(await within(conflicted).findByText("Conflict")).toBeVisible();
    expect(conflicted).toHaveTextContent(
      "Resolve it in the worktree and commit. Your primary checkout is untouched.",
    );

    act(() => useClientStore.getState().selectTask("subtask"));
    const shared = await within(details).findByTestId("worktree-block");
    await waitFor(() =>
      expect(shared).toHaveTextContent(
        "Shares the worktree of its parent task (CODING-1002 · Top-level task).",
      ),
    );
    expect(shared).not.toHaveTextContent(ownerTaskId);
    expect(
      within(shared).queryByRole("button", { name: "+ Create worktree" }),
    ).toBeNull();
  }, 20_000);
});
