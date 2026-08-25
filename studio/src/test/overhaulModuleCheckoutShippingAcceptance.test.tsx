import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { scratchBucketId, useTerminalStore } from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import {
  invalidateCheckoutChanges,
  moduleCheckout,
  worktreeCheckout,
  type CommitOutcome,
  type CommitPushOutcome,
  type PullRequestOutcome,
  type PushPreview,
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
  getWorktreePushPreview: vi.fn(),
  commitWorktreeChanges: vi.fn(),
  commitAndPushWorktreeChanges: vi.fn(),
  commitPushAndOpenPullRequest: vi.fn(),
  openPullRequest: vi.fn(),
  getModuleChanges: vi.fn(),
  getModuleFileDiff: vi.fn(),
  getModulePushPreview: vi.fn(),
  commitModuleChanges: vi.fn(),
  commitAndPushModuleChanges: vi.fn(),
  commitPushAndOpenModulePullRequest: vi.fn(),
  openModulePullRequest: vi.fn(),
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
  getWorktreePushPreview: api.getWorktreePushPreview,
  commitWorktreeChanges: api.commitWorktreeChanges,
  commitAndPushWorktreeChanges: api.commitAndPushWorktreeChanges,
  commitPushAndOpenPullRequest: api.commitPushAndOpenPullRequest,
  openPullRequest: api.openPullRequest,
  getModuleChanges: api.getModuleChanges,
  getModuleFileDiff: api.getModuleFileDiff,
  getModulePushPreview: api.getModulePushPreview,
  commitModuleChanges: api.commitModuleChanges,
  commitAndPushModuleChanges: api.commitAndPushModuleChanges,
  commitPushAndOpenModulePullRequest: api.commitPushAndOpenModulePullRequest,
  openModulePullRequest: api.openModulePullRequest,
}));

vi.mock("../features/source-control/internal/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => (
    <div data-testid="patch-viewer">{patch}</div>
  ),
}));

const MODULE_ID = "module-1";
const SHA = "6b21c0d4e5f6a7b8c9d0e1f2a3b4c5d6e7f80912";
const PR_URL = "https://github.com/ticketry-hq/ticketry/pull/985";

/** The module base checkout: on the repository's default branch, as usual. */
const CHANGES: WorktreeChanges = {
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

/** The same checkout parked on a feature branch, where a PR is possible. */
const ON_FEATURE_BRANCH: WorktreeChanges = {
  ...CHANGES,
  branch: "sync/module-work",
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
  branch: "main",
  remote: "origin",
  commit_count: 1,
  dirty: true,
  detail: "",
};

const COMMIT_STEPS: CommitOutcome["steps"] = [
  { name: "stage", status: "ok", detail: "Added 2 files to a reset index." },
  { name: "generate_message", status: "ok", detail: "Generated with claude." },
  { name: "commit", status: "ok", detail: "Committed 6b21c0d with hooks." },
];

const COMMITTED: CommitOutcome = {
  status: "committed",
  branch: "main",
  commit_sha: SHA,
  subject: "Update the release script",
  message_source: "claude",
  file_count: 2,
  insertions: 6,
  deletions: 1,
  steps: COMMIT_STEPS,
};

const PUSHED: CommitPushOutcome = {
  status: "committed_and_pushed",
  branch: "main",
  remote: "origin",
  commit_sha: SHA,
  subject: "Update the release script",
  message_source: "claude",
  file_count: 2,
  insertions: 6,
  deletions: 1,
  pushed_sha: SHA,
  failure_code: null,
  steps: [
    ...COMMIT_STEPS,
    { name: "push", status: "ok", detail: "Pushed 1 commit to origin/main." },
  ],
};

const DIVERGED: CommitPushOutcome = {
  ...PUSHED,
  status: "push_failed",
  pushed_sha: null,
  failure_code: "diverged",
  steps: [
    ...COMMIT_STEPS,
    {
      name: "push",
      status: "failed",
      detail:
        "origin/main has commits this branch does not. Ticketry never merges " +
        "or rebases for you — resolve it in a terminal, then push again.",
    },
  ],
};

const OPENED: PullRequestOutcome = {
  status: "opened",
  branch: "sync/module-work",
  base_branch: "main",
  remote: "origin",
  pull_request_url: PR_URL,
  pull_request_title: "Update the release script",
  pull_request_text_source: "claude",
  commit_sha: SHA,
  subject: "Update the release script",
  message_source: "claude",
  file_count: 2,
  insertions: 6,
  deletions: 1,
  pushed_sha: SHA,
  failure_code: null,
  steps: [
    ...COMMIT_STEPS,
    {
      name: "push",
      status: "ok",
      detail: "Pushed 1 commit to origin/sync/module-work.",
    },
    {
      name: "pull_request",
      status: "ok",
      detail:
        "Opened a pull request into main (title and body generated with claude).",
    },
  ],
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

async function openChangesTab() {
  await screen.findByRole("tab", { name: "Changes" });
  fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
  await screen.findByTestId("action-footer");
}

function primaryButton(): HTMLElement {
  return screen.getByRole("button", {
    name: /^(Commit & push|Committing & pushing…)$/,
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
  const rows = within(screen.getByTestId("action-steps")).getAllByRole("listitem");
  return Object.fromEntries(
    rows.map((row) => [
      row.getAttribute("data-testid")?.replace("action-step-", "") ?? "",
      row.getAttribute("data-state") ?? "",
    ]),
  );
}

async function confirmPush(button: string): Promise<void> {
  const confirmation = await screen.findByTestId("push-confirmation");
  await waitFor(() =>
    expect(confirmation.getAttribute("data-state")).toBe("ready"),
  );
  fireEvent.click(within(confirmation).getByRole("button", { name: button }));
}

describe("overhaul acceptance — shipping the module base checkout", () => {
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
    api.getModuleChanges.mockResolvedValue(CHANGES);
    api.getModuleFileDiff.mockResolvedValue({
      path: "README.md",
      status: "modified",
      binary: false,
      patch: "@@ -1 +1 @@\n-old intro\n+new intro\n",
      truncated: false,
    });
    api.getModulePushPreview.mockResolvedValue(READY);
    opened = vi.spyOn(window, "open").mockReturnValue(null);
  });

  it("[overhaul-199] offers the same action footer, leading with Commit & push", async () => {
    api.commitModuleChanges.mockResolvedValue(COMMITTED);
    let reads = 0;
    api.getModuleChanges.mockImplementation(async () =>
      reads++ === 0 ? CHANGES : CLEAN,
    );
    mountModuleWorkspace();
    await openChangesTab();

    // The primary action is the sync flow, not the pull-request stack: a base
    // checkout normally sits on the default branch, where a pull request is
    // refused (ADR 0013).
    const footer = screen.getByTestId("action-footer");
    expect(footer.getAttribute("data-primary-action")).toBe("commit_push");
    expect(primaryButton()).toBeTruthy();
    expect(footer.textContent).toContain("Repository hooks always run");
    expect(footer.textContent).toContain("push never forces");

    // The plan is visible before anything runs, and nothing has been read from
    // the remote or sent.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
    });
    expect(api.getModulePushPreview).not.toHaveBeenCalled();

    // Every shorter and longer action is still available, in the menu.
    const menu = openActionMenu();
    expect(
      within(menu).getByRole("button", { name: "Commit, push & create PR" }),
    ).toBeTruthy();
    fireEvent.click(
      within(menu).getByRole("button", { name: "Commit all changes" }),
    );

    // The commit takes the whole change set and names the module — no path
    // list, and no task identifiers anywhere on the wire.
    await waitFor(() =>
      expect(api.commitModuleChanges).toHaveBeenCalledWith(MODULE_ID),
    );
    expect(api.commitWorktreeChanges).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
      }),
    );
    expect(screen.getByTestId("action-outcome").textContent).toContain(
      "Committed 6b21c0d",
    );
    // The commit rewrote the checkout the panel was showing, so it is re-read.
    await waitFor(() => expect(api.getModuleChanges).toHaveBeenCalledTimes(2));
  });

  it("[overhaul-200] confirms the module push, then reports every step", async () => {
    api.commitAndPushModuleChanges.mockResolvedValue(PUSHED);
    let reads = 0;
    api.getModuleChanges.mockImplementation(async () =>
      reads++ === 0 ? CHANGES : CLEAN,
    );
    mountModuleWorkspace();
    await openChangesTab();

    fireEvent.click(primaryButton());

    // The confirmation is a real read of this checkout, and shows no generated
    // commit text — the message does not exist until the action runs.
    const confirmation = await screen.findByTestId("push-confirmation");
    await waitFor(() =>
      expect(confirmation.getAttribute("data-state")).toBe("ready"),
    );
    expect(api.getModulePushPreview).toHaveBeenCalledWith(
      MODULE_ID,
      expect.anything(),
    );
    expect(screen.getByTestId("push-confirmation-branch").textContent).toBe("main");
    expect(screen.getByTestId("push-confirmation-remote").textContent).toBe("origin");
    expect(screen.getByTestId("push-confirmation-commits").textContent).toBe("1");
    // This action opens no pull request, and does not claim to.
    expect(screen.queryByTestId("push-confirmation-pull-request")).toBeNull();
    expect(confirmation.textContent).not.toContain("Update the release script");
    expect(api.commitAndPushModuleChanges).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Push to origin" }),
    );

    await waitFor(() =>
      expect(api.commitAndPushModuleChanges).toHaveBeenCalledWith(MODULE_ID),
    );
    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
        push: "ok",
      }),
    );
    expect(screen.getByTestId("action-outcome").textContent).toContain(
      "pushed to origin/main",
    );
    // The confirmation is spent, and the review the action rewrote is re-read.
    expect(screen.queryByTestId("push-confirmation")).toBeNull();
    await waitFor(() => expect(api.getModuleChanges).toHaveBeenCalledTimes(2));
  });

  it("[overhaul-201] opens a pull request from a module checkout on a feature branch", async () => {
    api.getModuleChanges.mockResolvedValue(ON_FEATURE_BRANCH);
    api.getModulePushPreview.mockResolvedValue({
      ...READY,
      branch: "sync/module-work",
    });
    api.commitPushAndOpenModulePullRequest.mockResolvedValue(OPENED);
    mountModuleWorkspace();
    await openChangesTab();

    // Reviewed in the same viewer before shipping, from the same file list.
    fireEvent.click(changedFileRow("README.md"));
    expect((await screen.findByTestId("patch-viewer")).textContent).toContain(
      "+new intro",
    );

    fireEvent.click(
      within(openActionMenu()).getByRole("button", {
        name: "Commit, push & create PR",
      }),
    );
    // The longer action promises the pull request it is going to open.
    expect(
      (await screen.findByTestId("push-confirmation-pull-request")).textContent,
    ).toContain("your own gh login");
    await confirmPush("Push to origin & create PR");

    await waitFor(() =>
      expect(api.commitPushAndOpenModulePullRequest).toHaveBeenCalledWith(
        MODULE_ID,
      ),
    );
    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
        push: "ok",
        pull_request: "ok",
      }),
    );
    expect(screen.getByTestId("action-outcome").textContent).toContain(
      "Opened a pull request into main",
    );
    expect(screen.getByTestId("pull-request-url").textContent).toBe(PR_URL);
    // Landed on, once.
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(PR_URL, "_blank", "noopener,noreferrer");
  });

  it("[overhaul-202] refuses a pull request from the module checkout's default branch", async () => {
    api.commitPushAndOpenModulePullRequest.mockRejectedValue(
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
    mountModuleWorkspace();
    await openChangesTab();

    fireEvent.click(
      within(openActionMenu()).getByRole("button", {
        name: "Commit, push & create PR",
      }),
    );
    await confirmPush("Push to origin & create PR");

    const failure = await screen.findByTestId("action-failure");
    expect(failure.textContent).toContain("default branch");
    expect(failure.textContent).toContain("feature branch");
    // A precondition, so no step ran, nothing was opened, and the review the
    // action refused is still on screen.
    expect(stepStates()).toEqual({
      stage: "pending",
      generate_message: "pending",
      commit: "pending",
      push: "pending",
      pull_request: "pending",
    });
    expect(screen.queryByTestId("action-outcome")).toBeNull();
    expect(opened).not.toHaveBeenCalled();
    expect(changedFileRow("README.md")).toBeTruthy();
  });

  it("[overhaul-203] reports module hook refusals and a diverged push in this checkout's own words", async () => {
    api.commitModuleChanges.mockRejectedValue(
      new WorkTrackerApiError(
        409,
        "The repository's hooks refused this commit.",
        {
          detail: "The repository's hooks refused this commit.",
          code: "commit_refused",
          hook_output: "lint failed: scripts/release.sh is not executable",
        },
      ),
    );
    api.commitAndPushModuleChanges.mockResolvedValue(DIVERGED);
    mountModuleWorkspace();
    await openChangesTab();

    fireEvent.click(
      within(openActionMenu()).getByRole("button", { name: "Commit all changes" }),
    );

    // The hook's own words are the one raw output this surface ever shows.
    expect((await screen.findByTestId("action-failure")).textContent).toContain(
      "hooks refused",
    );
    expect(screen.getByTestId("action-hook-output").textContent).toContain(
      "scripts/release.sh is not executable",
    );
    expect(changedFileRow("README.md")).toBeTruthy();

    fireEvent.click(primaryButton());
    await confirmPush("Push to origin");

    await waitFor(() =>
      expect(stepStates()).toEqual({
        stage: "ok",
        generate_message: "ok",
        commit: "ok",
        push: "failed",
      }),
    );
    expect(screen.getByTestId("action-step-push").textContent).toContain(
      "resolve it in a terminal",
    );
    // The commit stands, and the sentence names this checkout rather than a
    // worktree the module review never had.
    const outcome = screen.getByTestId("action-outcome");
    expect(outcome.textContent).toContain("safe in this checkout");
    expect(outcome.textContent).not.toContain("worktree");
  });

  it("[overhaul-204] keeps module commands and cached data bound to the module checkout", async () => {
    api.commitAndPushModuleChanges.mockResolvedValue(PUSHED);
    mountModuleWorkspace();
    await openChangesTab();

    fireEvent.click(primaryButton());
    await confirmPush("Push to origin");
    await waitFor(() =>
      expect(api.commitAndPushModuleChanges).toHaveBeenCalledTimes(1),
    );

    // Not one worktree command was issued for a module action.
    expect(api.commitWorktreeChanges).not.toHaveBeenCalled();
    expect(api.commitAndPushWorktreeChanges).not.toHaveBeenCalled();
    expect(api.commitPushAndOpenPullRequest).not.toHaveBeenCalled();
    expect(api.getWorktreePushPreview).not.toHaveBeenCalled();
    expect(api.getWorktreeChanges).not.toHaveBeenCalled();

    const readsAfterAction = api.getModuleChanges.mock.calls.length;
    const previewsAfterAction = api.getModulePushPreview.mock.calls.length;

    // Invalidating a task worktree in this very module leaves the module's
    // review and its confirmation alone: the keys never overlap.
    await invalidateCheckoutChanges(
      worktreeCheckout("story-917", { moduleId: MODULE_ID }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.getModuleChanges).toHaveBeenCalledTimes(readsAfterAction);

    // Invalidating this checkout does re-read it — and re-opening the
    // confirmation re-probes the remote rather than serving the spent count.
    api.getModuleChanges.mockResolvedValue(CLEAN);
    await invalidateCheckoutChanges(moduleCheckout(MODULE_ID));
    await screen.findByText("This checkout matches its last commit.");

    fireEvent.click(primaryButton());
    await confirmPush("Push to origin");
    await waitFor(() =>
      expect(api.getModulePushPreview.mock.calls.length).toBeGreaterThan(
        previewsAfterAction,
      ),
    );
  });
});
