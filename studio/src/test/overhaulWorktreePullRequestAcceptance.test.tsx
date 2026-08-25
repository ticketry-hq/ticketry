import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import type {
  PullRequestOutcome,
  PushPreview,
  WorktreeChanges,
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
  commitWorktreeChanges: vi.fn(),
  getWorktreePushPreview: vi.fn(),
  commitAndPushWorktreeChanges: vi.fn(),
  commitPushAndOpenPullRequest: vi.fn(),
  openPullRequest: vi.fn(),
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
  getWorktreePushPreview: api.getWorktreePushPreview,
  commitAndPushWorktreeChanges: api.commitAndPushWorktreeChanges,
  commitPushAndOpenPullRequest: api.commitPushAndOpenPullRequest,
  openPullRequest: api.openPullRequest,
}));

vi.mock("../features/source-control/internal/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => (
    <div data-testid="patch-viewer">{patch}</div>
  ),
}));

const PR_URL = "https://github.com/ticketry-hq/ticketry/pull/984";

const CHANGES: WorktreeChanges = {
  kind: "changes",
  checkout: "worktree",
  task_id: "story-917",
  top_level_task_id: "story-917",
  module_id: "module-1",
  path: "/tmp/wt/story-917",
  branch: "wt/CODIN-917-review",
  base_branch: "main",
  dirty: true,
  file_count: 2,
  unpushed_commit_count: 0,
  insertions: 5,
  deletions: 1,
  reason: null,
  files: [
    {
      path: "src/app/shell.tsx",
      status: "modified",
      original_path: null,
      binary: false,
      insertions: 4,
      deletions: 1,
    },
    {
      path: "src/app/new-panel.tsx",
      status: "untracked",
      original_path: null,
      binary: false,
      insertions: 1,
      deletions: 0,
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

const READY: PushPreview = {
  state: "ready",
  branch: "wt/CODIN-917-review",
  remote: "origin",
  commit_count: 3,
  dirty: true,
  detail: "",
};

const OPENED: PullRequestOutcome = {
  status: "opened",
  branch: "wt/CODIN-917-review",
  base_branch: "main",
  remote: "origin",
  pull_request_url: PR_URL,
  pull_request_title: "Add the review panel",
  pull_request_text_source: "claude",
  commit_sha: "9f13ab4c0d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80",
  subject: "Add the review panel",
  message_source: "claude",
  file_count: 2,
  insertions: 5,
  deletions: 1,
  pushed_sha: "9f13ab4c0d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80",
  failure_code: null,
  steps: [
    { name: "stage", status: "ok", detail: "Added 2 files to a reset index." },
    { name: "generate_message", status: "ok", detail: "Generated with claude." },
    { name: "commit", status: "ok", detail: "Committed 9f13ab4 with hooks." },
    {
      name: "push",
      status: "ok",
      detail: "Pushed 3 commits to origin/wt/CODIN-917-review.",
    },
    {
      name: "pull_request",
      status: "ok",
      detail:
        "Opened a pull request into main (title and body generated with claude).",
    },
  ],
};

const PROVIDER_REFUSED: PullRequestOutcome = {
  ...OPENED,
  status: "pull_request_failed",
  pull_request_url: null,
  steps: [
    ...OPENED.steps.slice(0, 4),
    {
      name: "pull_request",
      status: "failed",
      detail:
        "GitHub refused to open a pull request from wt/CODIN-917-review into " +
        "main. Run `gh pr create` in a terminal to see what it said.",
    },
  ],
};

const RETRY_OPENED: PullRequestOutcome = {
  ...OPENED,
  commit_sha: null,
  subject: null,
  message_source: null,
  file_count: 0,
  insertions: 0,
  deletions: 0,
  steps: [
    {
      name: "stage",
      status: "skipped",
      detail: "This action commits nothing.",
    },
    {
      name: "generate_message",
      status: "skipped",
      detail: "No commit to describe.",
    },
    {
      name: "commit",
      status: "skipped",
      detail: "Asked for the pull request only.",
    },
    {
      name: "push",
      status: "skipped",
      detail: "origin/wt/CODIN-917-review already has this commit.",
    },
    {
      name: "pull_request",
      status: "ok",
      detail:
        "Opened a pull request into main (title and body generated with claude).",
    },
  ],
};

const PUSH_FAILED: PullRequestOutcome = {
  ...OPENED,
  status: "push_failed",
  pushed_sha: null,
  pull_request_url: null,
  failure_code: "diverged",
  steps: [
    ...OPENED.steps.slice(0, 3),
    {
      name: "push",
      status: "failed",
      detail:
        "origin/wt/CODIN-917-review has commits this branch does not. " +
        "Ticketry never merges or rebases for you — resolve it in a " +
        "terminal, then push again.",
    },
    {
      name: "pull_request",
      status: "skipped",
      detail:
        "Nothing was pushed, so there is no branch on GitHub to open a pull " +
        "request from.",
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

async function openChangesTab() {
  await screen.findByRole("tab", { name: "Changes" });
  fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
  await screen.findByTestId("action-footer");
}

function stackButton(): HTMLElement {
  return screen.getByRole("button", {
    name: /Commit, push & create PR|Committing, pushing & creating PR…/,
  });
}

function openActionMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Other actions" }));
  return screen.getByTestId("action-menu");
}

function changedFileRow(path: string): HTMLElement {
  const rows = within(screen.getByTestId("changed-files")).getAllByRole(
    "treeitem",
  );
  const match = rows.find((row) =>
    (row.getAttribute("aria-label") ?? "").includes(path),
  );
  if (!match) throw new Error(`no changed-file row for ${path}`);
  return match;
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

async function confirmTheStack(): Promise<void> {
  fireEvent.click(stackButton());
  const confirmation = await screen.findByTestId("push-confirmation");
  await waitFor(() =>
    expect(confirmation.getAttribute("data-state")).toBe("ready"),
  );
  fireEvent.click(
    within(confirmation).getByRole("button", {
      name: "Push to origin & create PR",
    }),
  );
}

describe("overhaul acceptance — opening a pull request from the worktree", () => {
  let opened: ReturnType<typeof vi.spyOn>;

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
    api.getWorktreePushPreview.mockResolvedValue(READY);
    // The browser runtime's own way of reaching the system browser, stubbed so
    // the assertion is about Studio asking rather than about jsdom.
    opened = vi.spyOn(window, "open").mockReturnValue(null);
  });

  it("[overhaul-194] reviews a diff, confirms, then commits, pushes, opens the pull request, and lands the user on it", async () => {
    api.commitPushAndOpenPullRequest.mockResolvedValue(OPENED);
    let reads = 0;
    api.getWorktreeChanges.mockImplementation(async () =>
      reads++ === 0 ? CHANGES : CLEAN,
    );
    mountWorkspace();
    await openChangesTab();

    // The diff is reviewed first: one file's working-tree diff, read in place.
    fireEvent.click(changedFileRow("src/app/shell.tsx"));
    expect((await screen.findByTestId("patch-viewer")).textContent).toContain(
      "+new",
    );

    // The plan is visible before anything runs, the pull request included, and
    // nothing has been read from the remote or sent.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
      pull_request: "pending",
    });
    expect(api.getWorktreePushPreview).not.toHaveBeenCalled();

    fireEvent.click(stackButton());

    // The confirmation says a pull request follows, and still shows no
    // generated text — neither the commit subject nor the pull request title
    // exists until the action runs.
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    expect(
      screen.getByTestId("push-confirmation-pull-request").textContent,
    ).toContain("your own gh login");
    expect(confirmation.textContent).not.toContain("Add the review panel");
    expect(api.commitPushAndOpenPullRequest).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Push to origin & create PR",
      }),
    );

    // One request carrying the checkout and nothing else: no title, no body,
    // no base branch, and no file list.
    await waitFor(() =>
      expect(api.commitPushAndOpenPullRequest).toHaveBeenCalledWith(
        "story-917",
        { parentId: null, moduleId: "module-1" },
      ),
    );

    // Every step reports its own outcome, in the order it ran.
    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
        push: "ok",
        pull_request: "ok",
      }),
    );
    const outcome = screen.getByTestId("action-outcome");
    expect(outcome.textContent).toContain("Opened a pull request into main");
    expect(screen.getByTestId("pull-request-url").textContent).toBe(PR_URL);

    // The pull request is opened in the system browser, once.
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(PR_URL, "_blank", "noopener,noreferrer");

    // The confirmation is spent, and the review the action rewrote is re-read.
    expect(screen.queryByTestId("push-confirmation")).toBeNull();
    await waitFor(() =>
      expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2),
    );
  });

  it("[overhaul-195] refuses the action on the default branch without sending anything", async () => {
    api.commitPushAndOpenPullRequest.mockRejectedValue(
      new WorkTrackerApiError(
        409,
        "main is this repository's default branch, so there is nothing to " +
          "open a pull request against. Check out a feature branch in a " +
          "terminal first.",
        {
          detail:
            "main is this repository's default branch, so there is nothing " +
            "to open a pull request against. Check out a feature branch in a " +
            "terminal first.",
          code: "pull_request_default_branch",
          branch: "main",
        },
      ),
    );
    mountWorkspace();
    await openChangesTab();

    await confirmTheStack();

    const failure = await screen.findByTestId("action-failure");
    expect(failure.textContent).toContain("default branch");
    expect(failure.textContent).toContain("feature branch");
    // A precondition, so no step ran and nothing was opened.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
      pull_request: "pending",
    });
    expect(screen.queryByTestId("action-outcome")).toBeNull();
    expect(opened).not.toHaveBeenCalled();
    // The review the action refused is still on screen.
    expect(changedFileRow("src/app/shell.tsx")).toBeTruthy();
  });

  it("[overhaul-196] keeps the commit and the push when GitHub refuses, and offers the pull request on its own", async () => {
    api.commitPushAndOpenPullRequest.mockResolvedValue(PROVIDER_REFUSED);
    api.openPullRequest.mockResolvedValue(RETRY_OPENED);
    mountWorkspace();
    await openChangesTab();

    await confirmTheStack();

    // The commit and the push both stand, and the copy says so rather than
    // leaving the user to guess whether the work was lost.
    const outcome = await screen.findByTestId("action-outcome");
    expect(outcome.textContent).toContain("Pushed to origin/wt/CODIN-917-review");
    expect(outcome.textContent).toContain("The branch is published.");
    expect(stepStates()).toEqual({
      stage: "ok",
      generate_message: "ok",
      commit: "ok",
      push: "ok",
      pull_request: "failed",
    });
    // No provider output is shown — only the curated sentence.
    expect(screen.queryByTestId("action-hook-output")).toBeNull();
    expect(screen.queryByTestId("pull-request-url")).toBeNull();
    expect(opened).not.toHaveBeenCalled();

    // The next move is the last step alone: everything before it succeeded.
    fireEvent.click(screen.getByTestId("retry-pull-request"));

    await waitFor(() =>
      expect(api.openPullRequest).toHaveBeenCalledWith("story-917", {
        parentId: null,
        moduleId: "module-1",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pull-request-url").textContent).toBe(PR_URL),
    );
    // The steps it did not re-run report as explicit skips rather than
    // disappearing from the list.
    expect(stepStates()).toEqual({
      stage: "skipped",
      generate_message: "skipped",
      commit: "skipped",
      push: "skipped",
      pull_request: "ok",
    });
    expect(opened).toHaveBeenCalledWith(PR_URL, "_blank", "noopener,noreferrer");
  });

  it("[overhaul-197] skips the pull request when nothing was pushed, and offers no retry", async () => {
    api.commitPushAndOpenPullRequest.mockResolvedValue(PUSH_FAILED);
    mountWorkspace();
    await openChangesTab();

    await confirmTheStack();

    const outcome = await screen.findByTestId("action-outcome");
    expect(outcome.textContent).toContain("nothing was pushed");
    expect(outcome.textContent).toContain("safe in this worktree");
    expect(stepStates()).toEqual({
      stage: "ok",
      generate_message: "ok",
      commit: "ok",
      push: "failed",
      pull_request: "skipped",
    });
    expect(
      screen.getByTestId("action-step-pull_request").textContent,
    ).toContain("no branch on GitHub");
    // A pull request from an unpublished branch is not a retry worth offering.
    expect(screen.queryByTestId("retry-pull-request")).toBeNull();
    expect(screen.queryByTestId("pull-request-url")).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });

  it("[overhaul-198] keeps the shorter actions in the menu, and neither promises a pull request", async () => {
    api.commitAndPushWorktreeChanges.mockResolvedValue({
      status: "committed_and_pushed",
      branch: "wt/CODIN-917-review",
      remote: "origin",
      commit_sha: "9f13ab4c0d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80",
      subject: "Add the review panel",
      message_source: "claude",
      file_count: 2,
      insertions: 5,
      deletions: 1,
      pushed_sha: "9f13ab4c0d2e5f6a7b8c9d0e1f2a3b4c5d6e7f80",
      failure_code: null,
      steps: OPENED.steps.slice(0, 4),
    });
    mountWorkspace();
    await openChangesTab();

    const menu = openActionMenu();
    expect(
      within(menu).getByRole("button", { name: "Commit & push" }),
    ).toBeTruthy();
    expect(
      within(menu).getByRole("button", { name: "Commit all changes" }),
    ).toBeTruthy();

    fireEvent.click(within(menu).getByRole("button", { name: "Commit & push" }));

    // The same confirmation, saying only what this action does.
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    expect(screen.queryByTestId("push-confirmation-pull-request")).toBeNull();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Push to origin" }),
    );

    await waitFor(() =>
      expect(api.commitAndPushWorktreeChanges).toHaveBeenCalledTimes(1),
    );
    // The plan the step list shows is this action's, so no pull-request step is
    // offered for a run that was never going to make one.
    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
        push: "ok",
      }),
    );
    expect(api.commitPushAndOpenPullRequest).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });
});
