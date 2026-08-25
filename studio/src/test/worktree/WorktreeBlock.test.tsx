import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WorktreeBlock } from "../../features/agents/worktrees";
import * as api from "../../features/agents/worktrees/internal/api";
import type { WorktreeStatus } from "../../features/agents/worktrees/internal/api";

const base = {
  task_id: "t1",
  top_level_task_id: "t1",
  is_shared: false,
};

const none: WorktreeStatus = { ...base, kind: "none" };
const active: WorktreeStatus = {
  ...base,
  kind: "worktree",
  branch: "wt/CODIN-589-worktree-ui",
  base_branch: "main",
  path: "/wt/path",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 2,
  behind: 0,
  conflict: false,
};
const conflict: WorktreeStatus = {
  ...active,
  state: "conflict",
  conflict: true,
};
const noRepo: WorktreeStatus = { ...base, kind: "no_repo", reason: "no git repo" };

function renderBlock() {
  return render(
    <WorktreeBlock
      taskId="t1"
      parentId={null}
      moduleId="m1"
      projectId="p1"
      ticketSeq={589}
      taskName="Worktree UI"
    />,
  );
}

describe("WorktreeBlock (#589, shared CODIN-922)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows + Create worktree when none exists, and creates on click", async () => {
    vi.spyOn(api, "getWorktree").mockResolvedValue(none);
    const create = vi.spyOn(api, "createWorktree").mockResolvedValue(active);
    renderBlock();

    const btn = await screen.findByRole("button", { name: "+ Create worktree" });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByText(/wt\/CODIN-589-worktree-ui/)).toBeTruthy(),
    );
    expect(create).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ moduleId: "m1", ticketSeq: 589 }),
    );
  });

  it("renders the active worktree read-only with branch/base + ahead/behind", async () => {
    vi.spyOn(api, "getWorktree").mockResolvedValue(active);
    renderBlock();

    expect(
      await screen.findByText(/wt\/CODIN-589-worktree-ui → main/),
    ).toBeTruthy();
    expect(screen.getByText("clean")).toBeTruthy();
    expect(screen.getByText("↑2")).toBeTruthy();
    expect(screen.getByText(/lands automatically on Done/)).toBeTruthy();
    // No integrate / land control exists.
    expect(screen.queryByRole("button", { name: /land/i })).toBeNull();
  });

  it("surfaces a conflict line with the primary-untouched copy and no land control", async () => {
    vi.spyOn(api, "getWorktree").mockResolvedValue(conflict);
    renderBlock();

    expect(await screen.findByText("Conflict")).toBeTruthy();
    expect(screen.getByText(/primary checkout is untouched/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /land/i })).toBeNull();
  });

  it("discards only after explicit confirmation", async () => {
    vi.spyOn(api, "getWorktree")
      .mockResolvedValueOnce(active)
      .mockResolvedValue(none);
    const discard = vi
      .spyOn(api, "discardWorktree")
      .mockResolvedValue({ removed: true, reason: "" });
    renderBlock();

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    // Confirm prompt shown; nothing discarded yet.
    expect(discard).not.toHaveBeenCalled();

    // Cancel keeps the worktree.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(discard).not.toHaveBeenCalled();

    // Re-open and confirm → one discard call, then refetch flips to none.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "+ Create worktree" }),
      ).toBeTruthy(),
    );
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("shows the not-isolated banner and no controls for a no-repo task", async () => {
    vi.spyOn(api, "getWorktree").mockResolvedValue(noRepo);
    renderBlock();

    expect(await screen.findByText(/Changes are not isolated/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
