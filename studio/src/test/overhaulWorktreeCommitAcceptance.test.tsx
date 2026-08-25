import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import type { CommitOutcome, WorktreeChanges } from "../features/source-control";
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
  commitWorktreeChanges: vi.fn(),
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
  commitWorktreeChanges: api.commitWorktreeChanges,
}));

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

const CLEAN: WorktreeChanges = {
  ...CHANGES,
  dirty: false,
  file_count: 0,
  insertions: 0,
  deletions: 0,
  files: [],
};

const COMMITTED: CommitOutcome = {
  status: "committed",
  branch: "CODIN-917-review",
  commit_sha: "9f13ab4c0d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80",
  subject: "Add the review panel and drop the stale doc",
  message_source: "claude",
  file_count: 3,
  insertions: 7,
  deletions: 7,
  steps: [
    { name: "stage", status: "ok", detail: "Added 3 files to a reset index." },
    { name: "generate_message", status: "ok", detail: "Generated with claude." },
    { name: "commit", status: "ok", detail: "Committed 9f13ab4 with hooks." },
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

function stepStates(): Record<string, string> {
  const rows = within(screen.getByTestId("action-steps")).getAllByRole(
    "listitem",
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.getAttribute("data-testid")?.replace("action-step-", "") ?? "",
      row.getAttribute("data-state") ?? "",
    ]),
  );
}

/**
 * The commit-only action, which now lives in the footer's action menu.
 *
 * `Commit & push` is the primary action (CODING-961 HLD), so committing
 * without pushing is the deliberate second choice and is reached here the way
 * a user reaches it.
 */
function commitButton(): HTMLElement {
  if (!screen.queryByTestId("action-menu")) {
    fireEvent.click(screen.getByRole("button", { name: "Other actions" }));
  }
  return screen.getByRole("button", {
    name: /Commit all changes|Committing…/,
  });
}

describe("overhaul acceptance — committing worktree changes", () => {
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
    api.getWorktreeFileDiff.mockResolvedValue({
      path: "src/app/shell.tsx",
      status: "modified",
      binary: false,
      patch: "@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
    });
  });

  it("[overhaul-187] commits every changed file and shows each step's outcome in order", async () => {
    api.commitWorktreeChanges.mockResolvedValue(COMMITTED);
    // The checkout is dirty when reviewed and clean once committed, so the
    // re-read after the mutation has to see the commit land.
    let reads = 0;
    api.getWorktreeChanges.mockImplementation(async () =>
      reads++ === 0 ? CHANGES : CLEAN,
    );
    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(changedFileRows()).toHaveLength(3));

    // The action names what it does and says hooks are not optional, before
    // anything runs; the steps are visible as a plan, not yet as progress.
    const footer = screen.getByTestId("action-footer");
    expect(footer.textContent).toContain("Repository hooks always run");
    // The plan shown before anything runs is the primary action's, push and
    // pull request and all — the footer does not pretend a commit-only run is
    // the default.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
      pull_request: "pending",
    });

    fireEvent.click(commitButton());

    // No path list crosses the wire: the checkout is the only choice made.
    await waitFor(() =>
      expect(api.commitWorktreeChanges).toHaveBeenCalledWith("story-917", {
        parentId: null,
        moduleId: "module-1",
      }),
    );

    const outcome = await screen.findByTestId("action-outcome");
    expect(outcome.textContent).toContain("Committed 9f13ab4");
    expect(outcome.textContent).toContain("3 files");
    expect(outcome.textContent).toContain(
      "Add the review panel and drop the stale doc",
    );

    // Every step reports its own outcome, in the order it ran.
    expect(stepStates()).toEqual({
      stage: "ok",
      generate_message: "ok",
      commit: "ok",
    });
    const steps = within(screen.getByTestId("action-steps"));
    expect(steps.getByTestId("action-step-commit").textContent).toContain(
      "Committed 9f13ab4 with hooks.",
    );
    expect(
      steps.getByTestId("action-step-generate_message").textContent,
    ).toContain("Generated with claude.");

    // The commit rewrote what the panel was showing, so it re-reads.
    await waitFor(() =>
      expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2),
    );
    await screen.findByText("This worktree matches its last commit.");
  });

  it("[overhaul-188] shows a refused commit's hook output and leaves the review in place", async () => {
    api.commitWorktreeChanges.mockRejectedValue(
      new WorkTrackerApiError(
        409,
        "Git refused this commit. Repository hooks always run; their output is below.",
        {
          detail:
            "Git refused this commit. Repository hooks always run; their output is below.",
          code: "commit_refused",
          exit_code: 1,
          hook_output: "pre-commit: 2 lint errors in src/app/shell.tsx",
        },
      ),
    );
    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();
    await waitFor(() => expect(changedFileRows()).toHaveLength(3));

    fireEvent.click(commitButton());

    // The curated sentence, and the hook's own words underneath it — the one
    // place command output is shown on purpose.
    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toContain("Git refused this commit.");
    const output = screen.getByTestId("action-hook-output");
    expect(output.textContent).toContain(
      "pre-commit: 2 lint errors in src/app/shell.tsx",
    );

    // Nothing was committed, so the review it refused is still on screen.
    expect(changedFileRows()).toHaveLength(3);
    expect(screen.queryByTestId("action-outcome")).toBeNull();
  });

  it("[overhaul-189] offers no commit for a checkout that matches its last commit", async () => {
    api.getWorktreeChanges.mockResolvedValue(CLEAN);
    mountWorkspace();
    await screen.findByRole("tab", { name: "Changes" });
    openChangesTab();

    await screen.findByText("This worktree matches its last commit.");

    // The footer still explains itself, but there is nothing to commit.
    expect(screen.getByTestId("action-footer")).toBeTruthy();
    expect(commitButton()).toBeDisabled();
    expect(api.commitWorktreeChanges).not.toHaveBeenCalled();
  });
});
