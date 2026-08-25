import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import type {
  CommitPushOutcome,
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

const COMMITTED_AND_PUSHED: CommitPushOutcome = {
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
  steps: [
    { name: "stage", status: "ok", detail: "Added 2 files to a reset index." },
    { name: "generate_message", status: "ok", detail: "Generated with claude." },
    { name: "commit", status: "ok", detail: "Committed 9f13ab4 with hooks." },
    {
      name: "push",
      status: "ok",
      detail: "Pushed 3 commits to origin/wt/CODIN-917-review.",
    },
  ],
};

const DIVERGED: CommitPushOutcome = {
  ...COMMITTED_AND_PUSHED,
  status: "push_failed",
  pushed_sha: null,
  failure_code: "diverged",
  steps: [
    ...COMMITTED_AND_PUSHED.steps.slice(0, 3),
    {
      name: "push",
      status: "failed",
      detail:
        "origin/wt/CODIN-917-review has commits this branch does not. " +
        "Ticketry never merges or rebases for you — resolve it in a " +
        "terminal, then push again.",
    },
  ],
};

const UP_TO_DATE: CommitPushOutcome = {
  status: "up_to_date",
  branch: "wt/CODIN-917-review",
  remote: "origin",
  commit_sha: null,
  subject: null,
  message_source: null,
  file_count: 0,
  insertions: 0,
  deletions: 0,
  pushed_sha: null,
  failure_code: null,
  steps: [
    {
      name: "stage",
      status: "skipped",
      detail: "This checkout matches its last commit.",
    },
    {
      name: "generate_message",
      status: "skipped",
      detail: "No changes to describe.",
    },
    { name: "commit", status: "skipped", detail: "Nothing to commit." },
    {
      name: "push",
      status: "skipped",
      detail: "origin/wt/CODIN-917-review already has this commit.",
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

/**
 * `Commit & push` as a user reaches it.
 *
 * The primary action is the whole stack — commit, push, and pull request
 * (CODING-984) — so publishing without opening a pull request is the
 * deliberate second choice and lives in the action menu.
 */
function pushButton(): HTMLElement {
  if (!screen.queryByTestId("action-menu")) {
    fireEvent.click(screen.getByRole("button", { name: "Other actions" }));
  }
  return screen.getByRole("button", {
    name: /Commit & push|Committing & pushing…/,
  });
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

describe("overhaul acceptance — pushing the worktree branch", () => {
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
  });

  it("[overhaul-190] confirms the branch, remote and commit count before pushing, then reports every step", async () => {
    api.commitAndPushWorktreeChanges.mockResolvedValue(COMMITTED_AND_PUSHED);
    let reads = 0;
    api.getWorktreeChanges.mockImplementation(async () =>
      reads++ === 0 ? CHANGES : CLEAN,
    );
    mountWorkspace();
    await openChangesTab();

    // Nothing is read from the remote and nothing is sent until the user asks.
    expect(api.getWorktreePushPreview).not.toHaveBeenCalled();
    // The plan on screen is the primary action's — the whole stack — until a
    // shorter action is chosen.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
      pull_request: "pending",
    });

    fireEvent.click(pushButton());

    // The confirmation states the three facts, and nothing has left yet.
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    expect(
      screen.getByTestId("push-confirmation-branch").textContent,
    ).toBe("wt/CODIN-917-review");
    expect(screen.getByTestId("push-confirmation-remote").textContent).toBe(
      "origin",
    );
    expect(screen.getByTestId("push-confirmation-commits").textContent).toBe(
      "3",
    );
    expect(confirmation.textContent).toContain("never forces");
    // No generated text is offered for review here — the subject is written
    // inside the action, after this point.
    expect(confirmation.textContent).not.toContain("Add the review panel");
    expect(api.commitAndPushWorktreeChanges).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Push to origin" }),
    );

    // One request, carrying the checkout and nothing else: no remote to pick
    // and no force to set.
    await waitFor(() =>
      expect(api.commitAndPushWorktreeChanges).toHaveBeenCalledWith(
        "story-917",
        { parentId: null, moduleId: "module-1" },
      ),
    );

    const outcome = await screen.findByTestId("action-outcome");
    expect(outcome.textContent).toContain("Committed 9f13ab4");
    expect(outcome.textContent).toContain("pushed to origin/wt/CODIN-917-review");

    // Every step reports its own outcome, in the order it ran.
    expect(stepStates()).toEqual({
      stage: "ok",
      generate_message: "ok",
      commit: "ok",
      push: "ok",
    });
    expect(
      within(screen.getByTestId("action-steps")).getByTestId("action-step-push")
        .textContent,
    ).toContain("Pushed 3 commits to origin/wt/CODIN-917-review.");

    // The confirmation is spent, and the review it described is re-read.
    expect(screen.queryByTestId("push-confirmation")).toBeNull();
    await waitFor(() =>
      expect(api.getWorktreeChanges).toHaveBeenCalledTimes(2),
    );
  });

  it("[overhaul-191] reports a diverged branch as a failed push that kept the commit", async () => {
    api.commitAndPushWorktreeChanges.mockResolvedValue(DIVERGED);
    mountWorkspace();
    await openChangesTab();

    fireEvent.click(pushButton());
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Push to origin" }),
    );

    const outcome = await screen.findByTestId("action-outcome");
    // The commit survived the failed push, and the copy says so rather than
    // leaving the user to guess whether their work was lost.
    expect(outcome.textContent).toContain("Committed 9f13ab4");
    expect(outcome.textContent).toContain("nothing was pushed");
    expect(outcome.textContent).toContain("safe in this worktree");

    // The commit step is done and the push step is the one that failed.
    expect(stepStates()).toEqual({
      stage: "ok",
      generate_message: "ok",
      commit: "ok",
      push: "failed",
    });
    const push = screen.getByTestId("action-step-push");
    expect(push.textContent).toContain("resolve it in a terminal");
    // The curated sentence is the whole story: no git output is shown.
    expect(screen.queryByTestId("action-hook-output")).toBeNull();
  });

  it("[overhaul-192] blocks the confirmation on a detached HEAD and sends nothing", async () => {
    api.getWorktreePushPreview.mockResolvedValue({
      state: "detached_head",
      branch: "",
      remote: null,
      commit_count: 0,
      dirty: false,
      detail:
        "This checkout is on a detached HEAD, so there is no branch to push. " +
        "Check out a branch in a terminal first.",
    } satisfies PushPreview);
    mountWorkspace();
    await openChangesTab();

    fireEvent.click(pushButton());

    const blocked = await screen.findByTestId("push-confirmation-blocked");
    expect(blocked.textContent).toContain("detached HEAD");
    expect(blocked.textContent).toContain("terminal");
    // There is no confirm button to press, so the action cannot be started.
    expect(
      screen.queryByRole("button", { name: /^Push to/ }),
    ).toBeNull();
    expect(api.commitAndPushWorktreeChanges).not.toHaveBeenCalled();
  });

  it("[overhaul-193] reports an up-to-date remote as an explicit skip", async () => {
    api.getWorktreeChanges.mockResolvedValue(CLEAN);
    api.getWorktreePushPreview.mockResolvedValue({
      ...READY,
      commit_count: 1,
      dirty: false,
    } satisfies PushPreview);
    api.commitAndPushWorktreeChanges.mockResolvedValue(UP_TO_DATE);
    mountWorkspace();
    await openChangesTab();

    // A clean worktree can still have unpushed commits, so the push action is
    // offered even though there is nothing to commit.
    expect(pushButton()).not.toBeDisabled();
    fireEvent.click(pushButton());
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Push to origin" }),
    );

    const outcome = await screen.findByTestId("action-outcome");
    expect(outcome.textContent).toContain("Nothing to do");

    // Every step is a skip, and the push says so in its own words rather than
    // being silently absent.
    expect(stepStates()).toEqual({
      stage: "skipped",
      generate_message: "skipped",
      commit: "skipped",
      push: "skipped",
    });
    expect(screen.getByTestId("action-step-push").textContent).toContain(
      "already has this commit",
    );
  });
});
