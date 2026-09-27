import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { WorktreeBlock } from "../../features/agents/worktrees";
import type { WorktreeStatus } from "../../features/agents/worktrees/internal/types";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  WorktreeStatusDocument,
  type WorktreeStatusQuery,
} from "../../features/agents/worktrees/generated/worktreeStatus.documents";
import { requestWorktreeCreate } from "../../features/agents/worktrees/internal/createTransport";
import { requestWorktreeDiscard } from "../../features/agents/worktrees/internal/discardTransport";

vi.mock("../../features/agents/worktrees/internal/createTransport", () => ({
  newOperationId: vi.fn(() => "operation-1"),
  requestWorktreeCreate: vi.fn(),
}));
vi.mock("../../features/agents/worktrees/internal/discardTransport", () => ({
  requestWorktreeDiscard: vi.fn(),
}));

const base = {
  task_id: "t1",
  top_level_task_id: "t1",
  is_shared: false,
  branch: null,
  base_branch: null,
  path: null,
  state: null,
  clean: null,
  dirty: null,
  ahead: null,
  behind: null,
  conflict: null,
  checkout_present: null,
  ephemeral: false,
  reason: null,
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
  checkout_present: true,
};
const conflict: WorktreeStatus = {
  ...active,
  state: "conflict",
  conflict: true,
};
const noRepo: WorktreeStatus = { ...base, kind: "no_repo", reason: "no git repo" };

function seed(status: WorktreeStatus): void {
  studioApolloClient().writeQuery<WorktreeStatusQuery>({
    query: WorktreeStatusDocument,
    variables: { taskId: "t1" },
    data: {
      worktree_status: {
        __typename: "WorktreeStatusView",
        ...status,
      },
    } as unknown as WorktreeStatusQuery,
  });
}

function renderBlock() {
  return render(
    <WorktreeBlock
      taskId="t1"
      parentId={null}
      moduleId="m1"
    />,
  );
}

describe("WorktreeBlock (#589, shared CODIN-922)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await studioApolloClient().clearStore();
  });

  it("shows + Worktree when none exists, and creates on click", async () => {
    seed(none);
    const create = vi.mocked(requestWorktreeCreate).mockResolvedValue(active);
    renderBlock();

    const btn = await screen.findByRole("button", { name: "+ Worktree" });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByText(/wt\/CODIN-589-worktree-ui/)).toBeTruthy(),
    );
    expect(create).toHaveBeenCalledWith("t1", "operation-1");
  });

  it("renders the active worktree read-only with branch/base + ahead/behind", async () => {
    seed(active);
    renderBlock();

    expect(
      await screen.findByRole("button", {
        name: "View changes on wt/CODIN-589-worktree-ui",
      }),
    ).toBeTruthy();
    expect(screen.getByText("↑2 ↓0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show worktree details" }));
    const details = await screen.findByTestId("worktree-details");
    expect(within(details).getByText("Clean")).toBeTruthy();
    expect(within(details).getByText("↑2 ↓0 vs main")).toBeTruthy();
    expect(within(details).getByText("Completion keeps the worktree")).toBeTruthy();
    expect(within(details).getByText("/wt/path")).toBeTruthy();
    // No integrate / land control exists.
    expect(screen.queryByRole("button", { name: /land/i })).toBeNull();
  });

  it("surfaces a conflict line without coupling it to Work Item completion", async () => {
    seed(conflict);
    renderBlock();

    fireEvent.click(
      await screen.findByRole("button", { name: "Show worktree details" }),
    );
    const details = await screen.findByTestId("worktree-details");
    expect(within(details).getByText("Conflict, resolve before shipping")).toBeTruthy();
    expect(
      within(details).getByText(/primary checkout and work item state stay unchanged/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /land/i })).toBeNull();
  });

  it("discards only after explicit confirmation", async () => {
    seed(active);
    const discard = vi.mocked(requestWorktreeDiscard).mockResolvedValue({
      removed: true,
      reason: "",
      status: none,
    });
    renderBlock();

    fireEvent.click(
      await screen.findByRole("button", { name: "Show worktree details" }),
    );
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
        screen.getByRole("button", { name: "+ Worktree" }),
      ).toBeTruthy(),
    );
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for a no-repo task", async () => {
    seed(noRepo);
    const { container } = renderBlock();

    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByTestId("worktree-block")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
