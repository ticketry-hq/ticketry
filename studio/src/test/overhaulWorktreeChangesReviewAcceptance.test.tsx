import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import {
  invalidateWorktreeChanges,
  type FileDiff,
  type WorktreeChanges,
} from "../features/source-control";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const api = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
  getWorkspaceTabOrder: vi.fn(),
  updateWorkspaceTabOrder: vi.fn(),
  getWorktreeChanges: vi.fn(),
  getWorktreeFileDiff: vi.fn(),
  discardMergedWorktree: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  getDocuments: api.getDocuments,
  getTerminals: api.getTerminals,
  listResumableTerminals: api.listResumableTerminals,
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  getWorkspaceTabOrder: api.getWorkspaceTabOrder,
  updateWorkspaceTabOrder: api.updateWorkspaceTabOrder,
}));

vi.mock("../features/source-control/api", () => ({
  getWorktreeChanges: api.getWorktreeChanges,
  getWorktreeFileDiff: api.getWorktreeFileDiff,
  discardMergedWorktree: api.discardMergedWorktree,
}));

// The syntax-highlighting viewer is loaded lazily behind a Suspense boundary
// and carries its own grammar bundle; the review flow under test is what the
// panel does around it, so it renders as a named stand-in here.
vi.mock("../features/source-control/internal/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => (
    <div data-testid="patch-viewer">{patch}</div>
  ),
}));

const CHANGES: WorktreeChanges = {
  kind: "changes",
  checkout: "worktree",
  task_id: "story-917",
  top_level_task_id: "story-917",
  module_id: "module-1",
  path: "/tmp/wt/story-917",
  branch: "CODIN-917-review",
  base_branch: "main",
  dirty: true,
  file_count: 3,
  unpushed_commit_count: 0,
  insertions: 7,
  deletions: 7,
  reason: null,
  files: [
    {
      path: "src/app/shell.tsx",
      status: "modified",
      original_path: null,
      binary: false,
      insertions: 4,
      deletions: 2,
    },
    {
      path: "src/app/new-panel.tsx",
      status: "untracked",
      original_path: null,
      binary: false,
      insertions: 3,
      deletions: 0,
    },
    {
      path: "docs/removed.md",
      status: "deleted",
      original_path: null,
      binary: false,
      insertions: 0,
      deletions: 5,
    },
  ],
};

const SHELL_DIFF: FileDiff = {
  path: "src/app/shell.tsx",
  status: "modified",
  binary: false,
  patch: "diff --git a/src/app/shell.tsx b/src/app/shell.tsx\n@@ -1 +1 @@\n-old\n+new\n",
  truncated: false,
};

const PANEL_DIFF: FileDiff = {
  path: "src/app/new-panel.tsx",
  status: "untracked",
  binary: false,
  patch: "diff --git a/src/app/new-panel.tsx b/src/app/new-panel.tsx\n@@ -0,0 +1 @@\n+brand new\n",
  truncated: false,
};

const TREE_CHANGES: WorktreeChanges = {
  ...CHANGES,
  file_count: 4,
  files: [
    {
      path: "src/app/file10.ts",
      status: "modified",
      original_path: null,
      binary: false,
      insertions: 4,
      deletions: 2,
    },
    {
      path: "src\\app\\file2.ts",
      status: "untracked",
      original_path: null,
      binary: false,
      insertions: 3,
      deletions: 0,
    },
    {
      path: "src/test/readme.md",
      status: "deleted",
      original_path: null,
      binary: false,
      insertions: 0,
      deletions: 5,
    },
    {
      path: "README.md",
      status: "copied",
      original_path: null,
      binary: true,
      insertions: null,
      deletions: null,
    },
  ],
};

function mountWorkspace() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SelectedTicketContent
        bucket="story-917"
        projectId="project-1"
        moduleId="module-1"
        owner="studio"
        details={<div>Issue details</div>}
      />
    </QueryClientProvider>,
  );
}

function openChangesTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
}

function changedFileRows(): string[] {
  return within(screen.getByTestId("changed-files"))
    .getAllByRole("treeitem")
    .filter((row) => row.hasAttribute("aria-selected"))
    .map((row) => row.getAttribute("aria-label") ?? "");
}

describe("overhaul acceptance — worktree changes review", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    queryClient.clear();
    localStorage.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useClientStore.setState({
      sidebarVisible: true,
      workspaces: {},
      activeByTask: {},
      toasts: [],
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    api.getDocuments.mockResolvedValue({ documents: [] });
    api.getTerminals.mockResolvedValue([]);
    api.listResumableTerminals.mockResolvedValue([]);
    api.getWorkspaceTabOrder.mockResolvedValue({ order: [] });
    api.updateWorkspaceTabOrder.mockImplementation(
      async (_workItemId: string, value: unknown) => value,
    );
    api.getWorktreeChanges.mockResolvedValue(CHANGES);
    api.getWorktreeFileDiff.mockImplementation(
      async (_taskId: string, path: string) =>
        path === SHELL_DIFF.path ? SHELL_DIFF : PANEL_DIFF,
    );
    api.discardMergedWorktree.mockResolvedValue({ removed: true, reason: "" });
  });

  it("[overhaul-181] reviews a worktree's changed files and diffs without a terminal", async () => {
    mountWorkspace();

    // The tab is pinned beside Details, and nothing is read from the checkout
    // until it is opened.
    await screen.findByRole("tab", { name: "Changes" });
    expect(api.getWorktreeChanges).not.toHaveBeenCalled();

    openChangesTab();

    await screen.findByTestId("changes-panel");
    await waitFor(() => expect(changedFileRows()).toHaveLength(3));

    // Modified, untracked, and deleted paths each read with their own counts.
    // The tree groups folders first and sorts leaf names naturally.
    expect(changedFileRows()).toEqual([
      "docs/removed.md — Deleted, +0 −5",
      "src/app/new-panel.tsx — New, +3 −0",
      "src/app/shell.tsx — Modified, +4 −2",
    ]);
    expect(screen.getByText("CODIN-917-review")).toBeTruthy();
    expect(screen.getByText("3 files · +7 −7")).toBeTruthy();

    // Status is colour, not words: each row carries one square swatch in the
    // shared git convention (green new, amber modified, red deleted), and the
    // word survives only in the accessible name and the hover title.
    const statusSwatch = (label: string, status: string) => {
      const swatch = screen
        .getByRole("treeitem", { name: label })
        .querySelector(`span[title="${status}"]`);
      expect(swatch).toBeTruthy();
      return swatch?.className ?? "";
    };
    expect(
      statusSwatch("docs/removed.md — Deleted, +0 −5", "Deleted"),
    ).toContain("bg-lifecycle-danger");
    expect(
      statusSwatch("src/app/new-panel.tsx — New, +3 −0", "New"),
    ).toContain("bg-lifecycle-success");
    expect(
      statusSwatch("src/app/shell.tsx — Modified, +4 −2", "Modified"),
    ).toContain("bg-lifecycle-attention");
    expect(screen.queryByText("Modified")).toBeNull();
    expect(screen.queryByText("Deleted")).toBeNull();

    // Selecting a file opens its working-tree diff in place.
    expect(screen.queryByTestId("patch-viewer")).toBeNull();
    fireEvent.click(
      screen.getByRole("treeitem", { name: /src\/app\/shell\.tsx/ }),
    );
    const viewer = await screen.findByTestId("patch-viewer");
    expect(viewer.textContent).toContain("+new");
    expect(api.getWorktreeFileDiff).toHaveBeenCalledWith(
      "story-917",
      "src/app/shell.tsx",
      { parentId: null, moduleId: "module-1" },
      expect.anything(),
    );

    // A second file replaces the diff rather than stacking another one.
    fireEvent.click(
      screen.getByRole("treeitem", { name: /src\/app\/new-panel\.tsx/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patch-viewer").textContent).toContain(
        "+brand new",
      ),
    );
    expect(screen.getAllByTestId("patch-viewer")).toHaveLength(1);
  });

  it("[overhaul-182] refreshes on demand and drops the cached review after a checkout mutation", async () => {
    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(changedFileRows()).toHaveLength(3));
    expect(api.getWorktreeChanges).toHaveBeenCalledTimes(1);

    // Refresh reads the checkout again rather than serving the cached answer.
    api.getWorktreeChanges.mockResolvedValue({
      ...CHANGES,
      file_count: 1,
      insertions: 4,
      deletions: 2,
      files: [CHANGES.files[0]],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(changedFileRows()).toHaveLength(1));
    expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2);

    // A mutation elsewhere invalidates the same contract, and the panel
    // re-reads without anyone touching Refresh.
    api.getWorktreeChanges.mockResolvedValue({
      ...CHANGES,
      file_count: 0,
      insertions: 0,
      deletions: 0,
      dirty: false,
      files: [],
    });
    await invalidateWorktreeChanges("story-917", { moduleId: "module-1" });
    await screen.findByText("This worktree matches its last commit.");
    expect(api.getWorktreeChanges).toHaveBeenCalledTimes(3);
  });

  it("[overhaul-183] explains an absent worktree and a curated read failure in place", async () => {
    api.getWorktreeChanges.mockResolvedValue({
      kind: "no_worktree",
      checkout: "worktree",
      task_id: "story-917",
      top_level_task_id: "story-917",
      module_id: "module-1",
      path: null,
      branch: null,
      base_branch: null,
      dirty: false,
      file_count: 0,
      unpushed_commit_count: 0,
      insertions: 0,
      deletions: 0,
      files: [],
      reason: "this task has no worktree yet",
    } satisfies WorktreeChanges);

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    await screen.findByText(
      "No worktree to review — this task has no worktree yet.",
    );

    api.getWorktreeChanges.mockRejectedValue(
      new Error("Git could not read this checkout's status from this checkout."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText(
      "Git could not read this checkout's status from this checkout.",
    );
  });

  it("[overhaul-212] checks the recorded pull request on each visit and Refresh, then offers merged cleanup", async () => {
    api.getWorktreeChanges
      .mockResolvedValueOnce({
        ...CHANGES,
        pull_request: {
          url: "https://github.com/ticketry-hq/ticketry/pull/42",
          number: 42,
          state: "OPEN",
        },
      })
      .mockResolvedValue({
        ...CHANGES,
        pull_request: {
          url: "https://github.com/ticketry-hq/ticketry/pull/42",
          number: 42,
          state: "MERGED",
        },
      });

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(api.getWorktreeChanges).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("pull-request-verdict")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    openChangesTab();
    await screen.findByText("PR #42 merged — clean up worktree?");
    expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.getWorktreeChanges).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId("pull-request-verdict")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("[overhaul-213] shows a closed pull request as information with no discard action", async () => {
    api.getWorktreeChanges.mockResolvedValue({
      ...CHANGES,
      pull_request: {
        url: "https://github.com/ticketry-hq/ticketry/pull/73",
        number: 73,
        state: "CLOSED",
      },
    });

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    const banner = await screen.findByTestId("pull-request-verdict");
    expect(banner.textContent).toContain(
      "Pull request #73 was closed without merging.",
    );
    expect(within(banner).getByRole("link", { name: "Pull request #73" })).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/73",
    );
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("[overhaul-214] keeps shipless and failed provider lookups silent", async () => {
    api.getWorktreeChanges.mockResolvedValue({
      ...CHANGES,
      pull_request: null,
    });

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(changedFileRows()).toHaveLength(3));
    expect(screen.queryByTestId("pull-request-verdict")).toBeNull();

    // The backend represents a provider failure the same way as no ship
    // record, so the checkout remains readable and no error notice appears.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2));
    expect(changedFileRows()).toHaveLength(3);
    expect(screen.queryByTestId("pull-request-verdict")).toBeNull();
    expect(screen.queryByText(/GitHub CLI|provider|pull request failed/i)).toBeNull();
  });

  it("[overhaul-215] requires confirmation for clean merged cleanup and cancellation preserves the worktree", async () => {
    api.getWorktreeChanges.mockResolvedValue({
      ...CHANGES,
      dirty: false,
      file_count: 0,
      unpushed_commit_count: 0,
      files: [],
      pull_request: {
        url: "https://github.com/ticketry-hq/ticketry/pull/42",
        number: 42,
        state: "MERGED",
      },
    });

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(api.discardMergedWorktree).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Discard this worktree? This removes the checkout, local branch, and remote-tracking ref.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.discardMergedWorktree).not.toHaveBeenCalled();
    expect(screen.getByText("PR #42 merged — clean up worktree?")).toBeTruthy();
  });

  it("[overhaul-216] confirms dirty losses from Changes data before discarding once", async () => {
    const merged = {
      ...CHANGES,
      unpushed_commit_count: 2,
      pull_request: {
        url: "https://github.com/ticketry-hq/ticketry/pull/42",
        number: 42,
        state: "MERGED" as const,
      },
    };
    api.getWorktreeChanges
      .mockResolvedValueOnce(merged)
      .mockResolvedValue({
        ...merged,
        kind: "no_worktree",
        path: null,
        branch: null,
        base_branch: null,
        dirty: false,
        file_count: 0,
        unpushed_commit_count: 0,
        files: [],
        reason: "this task's worktree is no longer on disk",
        pull_request: null,
      });

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(
      screen.getByText(
        "Discard this worktree? 3 files with uncommitted changes and 2 unpushed commits will be lost. This removes the checkout, local branch, and remote-tracking ref.",
      ),
    ).toBeTruthy();
    expect(api.discardMergedWorktree).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));

    await waitFor(() =>
      expect(api.discardMergedWorktree).toHaveBeenCalledWith({
        kind: "worktree",
        taskId: "story-917",
        parentId: null,
        moduleId: "module-1",
      }),
    );
    expect(api.discardMergedWorktree).toHaveBeenCalledTimes(1);
    await screen.findByText(
      "No worktree to review — this task's worktree is no longer on disk.",
    );
  });

  it("[overhaul-210] groups changed files in an expanded compact tree without changing diff selection", async () => {
    api.getWorktreeChanges.mockResolvedValue(TREE_CHANGES);
    api.getWorktreeFileDiff.mockImplementation(
      async (_taskId: string, path: string) => ({
        path,
        status: "modified",
        binary: false,
        patch: `diff --git a/${path} b/${path}\n+${path}\n`,
        truncated: false,
      }),
    );

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    const tree = await screen.findByRole("tree", { name: "Changed files" });
    const source = within(tree).getByRole("treeitem", {
      name: "Collapse src folder, +7 −7",
    });
    const [sourceChildren] = within(source).getAllByRole("group");
    const app = within(sourceChildren).getByRole("treeitem", {
      name: "Collapse src/app folder, +7 −2",
    });
    const appChildren = within(app).getByRole("group");
    const appFolderIcons = app.firstElementChild?.querySelectorAll("svg");
    expect(appFolderIcons).toHaveLength(2);
    expect(appFolderIcons?.[0]).toHaveAttribute("viewBox", "0 0 24 24");
    expect(appFolderIcons?.[0]).toHaveAttribute("stroke-width", "1.75");
    expect(appFolderIcons?.[1]).toHaveAttribute("viewBox", "0 0 24 24");
    expect(
      within(appChildren)
        .getAllByRole("treeitem")
        .map((row) => row.textContent),
    ).toEqual(["file2.ts+3 −0", "file10.ts+4 −2"]);
    expect(
      screen.getByRole("treeitem", { name: "README.md — Copied, binary" }),
    ).toBeTruthy();
    expect(changedFileRows()).toEqual([
      "src\\app\\file2.ts — New, +3 −0",
      "src/app/file10.ts — Modified, +4 −2",
      "src/test/readme.md — Deleted, +0 −5",
      "README.md — Copied, binary",
    ]);

    const firstFile = screen.getByRole("treeitem", {
      name: "src/app/file10.ts — Modified, +4 −2",
    });
    expect(firstFile.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 24 24",
    );
    fireEvent.click(firstFile);
    await waitFor(() =>
      expect(screen.getByTestId("patch-viewer").textContent).toContain(
        "+src/app/file10.ts",
      ),
    );

    const backslashFile = screen.getByRole("treeitem", {
      name: "src\\app\\file2.ts — New, +3 −0",
    });
    fireEvent.keyDown(backslashFile, { key: " " });
    await waitFor(() =>
      expect(screen.getByTestId("patch-viewer").textContent).toContain(
        "+src\\app\\file2.ts",
      ),
    );
    expect(backslashFile).toHaveAttribute("aria-selected", "true");
    expect(firstFile).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByTestId("patch-viewer")).toHaveLength(1);
    expect(api.getWorktreeFileDiff).toHaveBeenLastCalledWith(
      "story-917",
      "src\\app\\file2.ts",
      { parentId: null, moduleId: "module-1" },
      expect.anything(),
    );
  });

  it("[overhaul-211] collapses one folder or every folder and prunes stale folder state", async () => {
    api.getWorktreeChanges.mockResolvedValue(TREE_CHANGES);

    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    const appFolder = await screen.findByRole("treeitem", {
      name: "Collapse src/app folder, +7 −2",
    });
    const testFolder = screen.getByRole("treeitem", {
      name: "Collapse src/test folder, +0 −5",
    });
    expect(appFolder).toHaveAttribute("aria-expanded", "true");
    expect(testFolder).toHaveAttribute("aria-expanded", "true");

    appFolder.focus();
    expect(appFolder).toHaveFocus();
    fireEvent.keyDown(appFolder, { key: "Enter" });
    expect(
      screen.queryByRole("treeitem", { name: /src\\app\\file2\.ts/ }),
    ).toBeNull();
    expect(
      screen.getByRole("treeitem", { name: /src\/test\/readme\.md/ }),
    ).toBeTruthy();
    const expandApp = screen.getByRole("treeitem", {
      name: "Expand src/app folder, +7 −2",
    });
    expect(expandApp).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandApp);
    expect(
      screen.getByRole("treeitem", { name: /src\\app\\file2\.ts/ }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse all folders" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand all folders" }),
    ).toBeTruthy();
    expect(changedFileRows()).toEqual(["README.md — Copied, binary"]);

    fireEvent.click(
      screen.getByRole("treeitem", { name: "Expand src folder, +7 −7" }),
    );
    fireEvent.click(
      screen.getByRole("treeitem", {
        name: "Expand src/app folder, +7 −2",
      }),
    );
    fireEvent.click(
      screen.getByRole("treeitem", {
        name: "Expand src/test folder, +0 −5",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Collapse all folders" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse all folders" }),
    );
    expect(
      screen.getByRole("button", { name: "Expand all folders" }),
    ).toBeTruthy();
    expect(changedFileRows()).toEqual(["README.md — Copied, binary"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand all folders" }),
    );
    fireEvent.click(
      screen.getByRole("treeitem", {
        name: "Collapse src/app folder, +7 −2",
      }),
    );

    api.getWorktreeChanges.mockResolvedValue({
      ...TREE_CHANGES,
      file_count: 2,
      insertions: 0,
      deletions: 5,
      files: [TREE_CHANGES.files[2], TREE_CHANGES.files[3]],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("treeitem", {
      name: "Collapse src/test folder, +0 −5",
    });
    expect(
      screen.queryByRole("treeitem", { name: /src\/app folder/ }),
    ).toBeNull();

    api.getWorktreeChanges.mockResolvedValue(TREE_CHANGES);
    await invalidateWorktreeChanges("story-917", { moduleId: "module-1" });
    const restoredApp = await screen.findByRole("treeitem", {
      name: "Collapse src/app folder, +7 −2",
    });
    expect(restoredApp).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: /src\\app\\file2\.ts/ }),
    ).toBeTruthy();
  });
});
