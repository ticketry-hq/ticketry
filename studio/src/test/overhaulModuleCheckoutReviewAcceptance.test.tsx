import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { scratchBucketId, useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import {
  invalidateCheckoutChanges,
  moduleCheckout,
  worktreeCheckout,
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
  getModuleChanges: vi.fn(),
  getModuleFileDiff: vi.fn(),
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
  getModuleChanges: api.getModuleChanges,
  getModuleFileDiff: api.getModuleFileDiff,
}));

// The syntax-highlighting viewer carries its own grammar bundle; the review
// flow under test is what the panel does around it, so it stands in by name.
vi.mock("../features/source-control/internal/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => (
    <div data-testid="patch-viewer">{patch}</div>
  ),
}));

const MODULE_ID = "module-1";

/** A module base checkout: on its default branch, compared with nothing. */
const MODULE_CHANGES: WorktreeChanges = {
  kind: "changes",
  checkout: "module",
  task_id: null,
  top_level_task_id: null,
  module_id: MODULE_ID,
  path: "/Users/dev/ticketry",
  branch: "main",
  base_branch: null,
  dirty: true,
  file_count: 2,
  unpushed_commit_count: 0,
  insertions: 6,
  deletions: 1,
  reason: null,
  files: [
    {
      path: "README.md",
      status: "modified",
      original_path: null,
      binary: false,
      insertions: 2,
      deletions: 1,
    },
    {
      path: "scripts/release.sh",
      status: "untracked",
      original_path: null,
      binary: false,
      insertions: 4,
      deletions: 0,
    },
  ],
};

const README_DIFF: FileDiff = {
  path: "README.md",
  status: "modified",
  binary: false,
  patch: "diff --git a/README.md b/README.md\n@@ -1 +1 @@\n-old intro\n+new intro\n",
  truncated: false,
};

const RELEASE_DIFF: FileDiff = {
  path: "scripts/release.sh",
  status: "untracked",
  binary: false,
  patch: "diff --git a/scripts/release.sh b/scripts/release.sh\n@@ -0,0 +1 @@\n+set -euo pipefail\n",
  truncated: false,
};

/** The module's own workspace — the scratch bucket keyed by that module. */
function mountModuleWorkspace() {
  return render(
    <QueryClientProvider client={queryClient}>
      <SelectedTicketContent
        bucket={scratchBucketId(MODULE_ID)}
        projectId="project-1"
        moduleId={MODULE_ID}
        owner="studio"
        details={<div>Module details</div>}
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

describe("overhaul acceptance — module checkout review", () => {
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
    api.getModuleChanges.mockResolvedValue(MODULE_CHANGES);
    api.getModuleFileDiff.mockImplementation(async (_id: string, path: string) =>
      path === README_DIFF.path ? README_DIFF : RELEASE_DIFF,
    );
  });

  it("[overhaul-184] reviews the module base checkout's changed files and diffs", async () => {
    mountModuleWorkspace();

    // Pinned beside Details in the module's own workspace, and nothing is
    // read from the checkout until it is opened.
    await screen.findByRole("tab", { name: "Changes" });
    expect(api.getModuleChanges).not.toHaveBeenCalled();

    openChangesTab();

    const panel = await screen.findByTestId("changes-panel");
    expect(panel.getAttribute("data-checkout")).toBe("module");
    await waitFor(() => expect(changedFileRows()).toHaveLength(2));

    expect(changedFileRows()).toEqual([
      "scripts/release.sh — New, +4 −0",
      "README.md — Modified, +2 −1",
    ]);
    expect(api.getModuleChanges).toHaveBeenCalledWith(
      MODULE_ID,
      expect.anything(),
    );
    // A base checkout sits on its default branch; there is no merge target to
    // present it against.
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByText("2 files · +6 −1")).toBeTruthy();

    // Selecting a file opens its working-tree diff in place, same as a
    // worktree — one viewer, not a second one.
    fireEvent.click(screen.getByRole("treeitem", { name: /README\.md/ }));
    const viewer = await screen.findByTestId("patch-viewer");
    expect(viewer.textContent).toContain("+new intro");
    expect(api.getModuleFileDiff).toHaveBeenCalledWith(
      MODULE_ID,
      "README.md",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("treeitem", { name: /release\.sh/ }));
    await waitFor(() =>
      expect(screen.getByTestId("patch-viewer").textContent).toContain(
        "+set -euo pipefail",
      ),
    );
    expect(screen.getAllByTestId("patch-viewer")).toHaveLength(1);
  });

  it("[overhaul-185] scopes refresh and invalidation to the selected checkout", async () => {
    mountModuleWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(changedFileRows()).toHaveLength(2));
    expect(api.getModuleChanges).toHaveBeenCalledTimes(1);
    // The module review never reaches for the worktree endpoint.
    expect(api.getWorktreeChanges).not.toHaveBeenCalled();

    api.getModuleChanges.mockResolvedValue({
      ...MODULE_CHANGES,
      file_count: 1,
      insertions: 2,
      deletions: 1,
      files: [MODULE_CHANGES.files[0]],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(changedFileRows()).toHaveLength(1));
    expect(api.getModuleChanges).toHaveBeenCalledTimes(2);

    // Invalidating a task worktree that happens to live in this module leaves
    // the module's own review alone — the two never share a cache entry.
    await invalidateCheckoutChanges(
      worktreeCheckout("story-917", { moduleId: MODULE_ID }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.getModuleChanges).toHaveBeenCalledTimes(2);

    // Invalidating this checkout does re-read it.
    api.getModuleChanges.mockResolvedValue({
      ...MODULE_CHANGES,
      dirty: false,
      file_count: 0,
      insertions: 0,
      deletions: 0,
      files: [],
    });
    await invalidateCheckoutChanges(moduleCheckout(MODULE_ID));
    await screen.findByText("This checkout matches its last commit.");
    expect(api.getModuleChanges).toHaveBeenCalledTimes(3);
  });

  it("[overhaul-186] explains an unreadable module checkout in place", async () => {
    api.getModuleChanges.mockResolvedValue({
      ...MODULE_CHANGES,
      kind: "no_checkout",
      path: null,
      branch: null,
      dirty: false,
      file_count: 0,
      insertions: 0,
      deletions: 0,
      files: [],
      reason: "this module has no linked folder on this machine",
    } satisfies WorktreeChanges);

    mountModuleWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    await screen.findByText(
      "Nothing to review — this module has no linked folder on this machine.",
    );

    api.getModuleChanges.mockRejectedValue(
      new Error("Git could not read this checkout's status from this checkout."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText(
      "Git could not read this checkout's status from this checkout.",
    );
  });
});
