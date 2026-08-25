import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudioFooter } from "../app/shell/StudioFooter";
import * as worktreesApi from "../features/agents/worktrees/internal/api";
import type { WorktreeStatus } from "../features/agents/worktrees/internal/api";
import { useClientStore } from "../state/clientStore";
import type { WorktreeRevealRuntime } from "../features/agents/worktrees/OpenWorktreeInFinder";
import { fixture, mountStudio, workItem } from "./seam";

const status = (
  taskId: string,
  overrides: Partial<WorktreeStatus> = {},
): WorktreeStatus => ({
  kind: "worktree",
  task_id: taskId,
  top_level_task_id: taskId,
  is_shared: false,
  branch: `ticket/${taskId}`,
  base_branch: "main",
  path: `/tmp/ticketry-worktrees/${taskId}`,
  state: "active",
  clean: true,
  dirty: false,
  ahead: 0,
  behind: 0,
  conflict: false,
  ...overrides,
});

const absent = (taskId: string): WorktreeStatus => ({
  kind: "none",
  task_id: taskId,
  top_level_task_id: taskId,
  is_shared: false,
});

describe("overhaul acceptance — module Worktrees panel", () => {
  it("[overhaul-206] lists live module worktrees and keeps panel and ticket details in sync", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["dirty-task", "empty-task", "conflict-task"],
      children: {
        "dirty-task": ["subtask"],
        subtask: [],
        "empty-task": [],
        "conflict-task": [],
      },
      order: ["dirty-task", "subtask", "empty-task", "conflict-task"],
    });
    http.workItems([
      workItem({
        id: "dirty-task",
        key: "CODING-1001",
        name: "Dirty owner",
        sequence_id: 1001,
      }),
      workItem({
        id: "subtask",
        key: "CODING-1001A",
        name: "Shared child",
        parent_id: "dirty-task",
      }),
      workItem({
        id: "empty-task",
        key: "CODING-1002",
        name: "No worktree yet",
        sequence_id: 1002,
      }),
      workItem({
        id: "conflict-task",
        key: "CODING-1000",
        name: "Conflict owner",
        sequence_id: 1000,
      }),
    ]);

    const statuses = new Map<string, WorktreeStatus>([
      [
        "dirty-task",
        status("dirty-task", {
          branch: "ticket/CODING-1001-dirty-owner",
          clean: false,
          dirty: true,
          ahead: 4,
          behind: 2,
        }),
      ],
      ["empty-task", absent("empty-task")],
      [
        "conflict-task",
        status("conflict-task", {
          branch: "ticket/CODING-1000-conflict-owner",
          state: "conflict",
          conflict: true,
        }),
      ],
    ]);
    const getWorktree = vi
      .spyOn(worktreesApi, "getWorktree")
      .mockImplementation(async (taskId) => statuses.get(taskId)!);
    vi.spyOn(worktreesApi, "listWorktreeRecords").mockImplementation(async () =>
      [...statuses.entries()]
        .filter(([, worktree]) => worktree.kind === "worktree")
        .map(([task_id]) => ({ task_id })),
    );
    const create = vi
      .spyOn(worktreesApi, "createWorktree")
      .mockImplementation(async (taskId) => {
        const created = status(taskId, {
          branch: "ticket/CODING-1002-created",
          ahead: 1,
        });
        statuses.set(taskId, created);
        return created;
      });
    const discard = vi
      .spyOn(worktreesApi, "discardWorktree")
      .mockImplementation(async (taskId) => {
        statuses.set(taskId, absent(taskId));
        return { removed: true, reason: "" };
      });

    mountStudio({
      http,
      selectedTaskId: "dirty-task",
      children: <StudioFooter />,
    });

    const terminalToggle = screen.getByTestId("footer-terminal-toggle");
    const worktreesToggle = await screen.findByRole("button", {
      name: "Open Worktrees panel",
    });
    expect(terminalToggle.nextElementSibling?.contains(worktreesToggle)).toBe(true);
    fireEvent.click(worktreesToggle);
    let panel = await screen.findByRole("region", {
      name: "Module worktrees",
    });
    await within(panel).findByTestId("module-worktree-conflict-task");
    const statusCallCountAfterFirstOpen = getWorktree.mock.calls.length;
    expect(panel.closest(".overflow-hidden")).toBeNull();
    expect(useClientStore.getState().selectedTaskId).toBe("dirty-task");
    fireEvent.click(
      screen.getByRole("button", { name: "Close Worktrees panel" }),
    );
    expect(
      screen.queryByRole("region", { name: "Module worktrees" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Worktrees panel" }),
    );
    panel = await screen.findByRole("region", { name: "Module worktrees" });
    await waitFor(() =>
      expect(getWorktree).toHaveBeenCalledTimes(statusCallCountAfterFirstOpen),
    );
    const dirtyRow = await within(panel).findByTestId(
      "module-worktree-dirty-task",
    );
    expect(dirtyRow).toHaveTextContent("CODING-1001 · Dirty owner");
    expect(dirtyRow).toHaveTextContent("ticket/CODING-1001-dirty-owner");
    expect(dirtyRow).toHaveTextContent("dirty");
    expect(dirtyRow).toHaveTextContent("↑4");
    expect(dirtyRow).toHaveTextContent("↓2");
    expect(
      within(panel).getByTestId("module-worktree-conflict-task"),
    ).toHaveTextContent("conflicted");
    expect(within(panel).queryByText("Shared child")).toBeNull();
    expect(getWorktree).not.toHaveBeenCalledWith(
      "subtask",
      expect.anything(),
      expect.anything(),
    );
    expect(getWorktree).not.toHaveBeenCalledWith(
      "empty-task",
      expect.anything(),
      expect.anything(),
    );

    for (const forbidden of [
      "Create",
      "Terminal",
      "Integrate",
      "Retry",
      "Clear",
      "Review",
      "Commit",
      "Push",
      "Pull request",
    ]) {
      expect(within(panel).queryByRole("button", { name: forbidden })).toBeNull();
    }

    fireEvent.click(within(dirtyRow).getByRole("button", { name: "Discard" }));
    expect(discard).not.toHaveBeenCalled();
    expect(dirtyRow).toHaveTextContent(
      "Discard this dirty worktree? Uncommitted changes will be lost.",
    );
    fireEvent.click(within(dirtyRow).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dirtyRow).getByRole("button", { name: "Discard" }));
    fireEvent.click(
      within(dirtyRow).getByRole("button", { name: "Yes, discard" }),
    );

    await waitFor(() =>
      expect(
        within(panel).queryByTestId("module-worktree-dirty-task"),
      ).toBeNull(),
    );
    const details = screen.getByRole("region", { name: "Details" });
    expect(
      await within(details).findByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();

    act(() => useClientStore.getState().selectTask("empty-task"));
    const createButton = await within(details).findByRole("button", {
      name: "+ Create worktree",
    });
    fireEvent.click(createButton);
    expect(
      await within(panel).findByText("ticket/CODING-1002-created"),
    ).toBeVisible();
    expect(create).toHaveBeenCalledWith(
      "empty-task",
      expect.objectContaining({ moduleId: "module-1" }),
    );

    const createdRow = within(panel).getByTestId("module-worktree-empty-task");
    fireEvent.click(within(createdRow).getByRole("button", { name: "Discard" }));
    expect(createdRow).toHaveTextContent("Discard this worktree?");
    fireEvent.click(
      within(createdRow).getByRole("button", { name: "Yes, discard" }),
    );
    expect(
      await within(details).findByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();
    expect(discard).toHaveBeenCalledWith("empty-task", {
      parentId: "module-1",
      moduleId: "module-1",
    });
  }, 20_000);

  it("[overhaul-207] reveals a desktop worktree in Finder and hides the browser action", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: ["task-1004"],
      children: { "task-1004": [] },
      order: ["task-1004"],
    });
    http.workItems([
      workItem({
        id: "task-1004",
        key: "CODING-1004",
        name: "Reveal panel worktrees in Finder on desktop",
        sequence_id: 1004,
      }),
    ]);
    vi.spyOn(worktreesApi, "getWorktree").mockResolvedValue(status("task-1004"));
    vi.spyOn(worktreesApi, "listWorktreeRecords").mockResolvedValue([
      { task_id: "task-1004" },
    ]);

    const revealInFileManager = vi.fn().mockResolvedValue(undefined);
    const capabilities = {
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
      nativeFileManager: false,
    };
    const runtime: WorktreeRevealRuntime = {
      capabilities,
      revealInFileManager,
    };

    mountStudio({
      http,
      selectedTaskId: "task-1004",
      children: <StudioFooter worktreesRuntime={runtime} />,
    });

    fireEvent.click(await screen.findByRole("button", {
      name: "Open Worktrees panel",
    }));
    let panel = await screen.findByRole("region", { name: "Module worktrees" });
    expect(within(panel).queryByRole("button", { name: "Open in Finder" }))
      .toBeNull();

    capabilities.nativeFileManager = true;
    fireEvent.click(screen.getByRole("button", { name: "Close Worktrees panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Worktrees panel" }));
    panel = await screen.findByRole("region", { name: "Module worktrees" });
    const finder = await within(panel).findByRole("button", {
      name: "Open in Finder",
    });
    fireEvent.click(finder);

    await waitFor(() => expect(revealInFileManager).toHaveBeenCalledWith(
      "/tmp/ticketry-worktrees/task-1004",
    ));
  });

  it("[overhaul-208] reports a failed work-item read instead of loading forever", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [],
      children: {},
      order: [],
    });
    http.workItems([]);
    vi.spyOn(worktreesApi, "listWorktreeRecords").mockResolvedValue([
      { task_id: "unreadable-task" },
    ]);
    const getWorktree = vi.spyOn(worktreesApi, "getWorktree");
    getWorktree.mockClear();

    mountStudio({ http, children: <StudioFooter /> });
    fireEvent.click(await screen.findByRole("button", {
      name: "Open Worktrees panel",
    }));
    const panel = await screen.findByRole("region", { name: "Module worktrees" });

    expect(
      await within(panel).findByText("Some worktree statuses could not be loaded."),
    ).toBeVisible();
    expect(within(panel).queryByText("Loading worktrees…")).toBeNull();
    expect(getWorktree).not.toHaveBeenCalled();
  });

  it("[overhaul-209] consumes Escape and restores focus when the Worktrees panel closes", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [],
      children: {},
      order: [],
    });
    http.workItems([]);

    mountStudio({
      http,
      children: <StudioFooter />,
    });

    const trigger = await screen.findByRole("button", {
      name: "Open Worktrees panel",
    });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("region", {
      name: "Module worktrees",
    });
    const escapedWindow = vi.fn();
    window.addEventListener("keydown", escapedWindow);

    expect(fireEvent.keyDown(panel, { key: "Escape" })).toBe(false);

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Module worktrees" }),
      ).toBeNull();
      expect(trigger).toHaveFocus();
    });
    expect(escapedWindow).not.toHaveBeenCalled();

    window.removeEventListener("keydown", escapedWindow);

    fireEvent.click(trigger);
    await screen.findByRole("region", { name: "Module worktrees" });
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Module worktrees" }),
      ).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });
});
