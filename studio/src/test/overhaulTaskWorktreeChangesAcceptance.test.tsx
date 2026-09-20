import { isValidElement } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioLayout } from "../app/shell/StudioLayout";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { SelectedTicket } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicket";
import { FooterChangesToggle } from "../app/shell/FooterChangesToggle";
import { ChangesWorkspace } from "../features/agents/worktrees";
import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
} from "../features/workspace-state/studioWorkspaceTarget";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { WorktreeChangesDocument } from "../features/agents/worktrees/generated/worktreeChanges.documents";
import { WorktreeStatusDocument } from "../features/agents/worktrees/generated/worktreeStatus.documents";
import { fixture, mountStudio as mountStudioSeam, workItem } from "./seam";

// JSDOM has no panel measurements; exercise the real shell without imperative sizing.
vi.mock("../app/shell/layout/useStudioPanelLayout", () => ({
  useStudioPanelLayout: () => ({
    layout: [18, 32, 50],
    sidebarVisible: true,
    outerGroupRef: { current: null },
    workAreaGroupRef: { current: null },
    handleOuterLayout: () => {},
    handleWorkAreaLayout: () => {},
  }),
}));

const OWNER_ID = "task-worktree-owner";
const TASK_ID = "child-with-committed-work";

function mountStudio(options: Parameters<typeof mountStudioSeam>[0]) {
  return mountStudioSeam({
    ...options,
    children: (
      <>
        {options.children}
        {isValidElement(options.children) && options.children.type === StudioLayout ? null : <ChangesWorkspace />}
        <FooterChangesToggle />
      </>
    ),
  });
}

const activeCleanWorktree = {
  __typename: "WorktreeStatusView",
  kind: "worktree",
  task_id: TASK_ID,
  top_level_task_id: OWNER_ID,
  is_shared: true,
  branch: "wt/CODING-1321-task-worktree-changes",
  base_branch: "main",
  path: "/worktrees/CODING-1321-task-worktree-changes",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 1,
  behind: 0,
  conflict: false,
  checkout_present: true,
  ephemeral: false,
  reason: null,
};

const cumulativeChanges = {
  __typename: "WorktreeChangesView",
  task_id: TASK_ID,
  top_level_task_id: OWNER_ID,
  is_shared: true,
  base_commit: "0123456789abcdef0123456789abcdef01234567",
  committed_count: 1,
  pull_request_url: null,
  pull_request_creation_eligible: true,
  work_item_done: false,
  closure_failure: null,
  cleanup: {
    __typename: "WorktreeCleanupStatusView",
    eligible: false,
    blocker: "pull_request_absent",
    reason: "No pull request is mapped to this worktree.",
  },
  pull_request: {
    __typename: "PullRequestStatusView",
    url: null,
    state: "none",
    target_branch: null,
    head_commit: null,
    integrated: false,
    post_merge_work: false,
    replacement_eligible: false,
    follow_up_eligible: false,
    merge_preparation_eligible: false,
    reason: null as string | null,
  },
  clean: true,
  dirty: false,
  unpushed_count: 1,
  truncated: false,
  files: [
    ["src/added.ts", "added", null],
    ["src/untracked.ts", "untracked", null],
    ["src/modified.ts", "modified", null],
    ["src/deleted.ts", "deleted", null],
    ["src/renamed.ts", "renamed", "src/old-name.ts"],
    ["src/copied.ts", "copied", "src/original.ts"],
    ["src/conflicted.ts", "conflicted", null],
  ].map(([path, status, previousPath]) => ({
    __typename: "ChangedFile",
    path,
    status,
    previous_path: previousPath,
    binary: false,
    insertions: 1,
    deletions: 1,
  })),
  insertions: 7,
  deletions: 7,
};

describe("overhaul acceptance - task worktree Changes", () => {
  it("[overhaul-184] keeps cumulative committed work in a labeled, accessible Changes tab", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const http = fixture();
    let changesRequests = 0;
    const savedTabOrders: unknown[] = [];
    const diffRequests: unknown[] = [];
    let checkoutRequests = 0;
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Show cumulative task-worktree changes",
        parent_id: "module-1",
        sequence_id: 1321,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: <StudioLayout />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "CurrentWorktrees") checkoutRequests += 1;
        if (operation === "WorktreeFileDiff") {
          diffRequests.push(variables);
          return { worktree_file_diff: {
            __typename: "FileDiffView",
            path: "src/added.ts", status: "added", binary: false,
            patch: "", truncated: false,
          } } as never;
        }
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          changesRequests += 1;
          expect(variables).toEqual({ taskId: TASK_ID });
          return { worktree_changes: cumulativeChanges } as never;
        }
        if (operation === "UpdateWorkTrackerWorkspaceTabOrder") {
          savedTabOrders.push(
            (variables as { workspaceTabOrder: unknown }).workspaceTabOrder,
          );
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    const changesTab = await within(tabs).findByRole("tab", { name: "Changes" });
    expect(changesTab).toBeVisible();
    expect(changesRequests).toBe(0);
    await waitFor(() =>
      expect(savedTabOrders).toContainEqual([
        { kind: "details" },
      ]),
    );

    fireEvent.click(changesTab);
    await waitFor(() => expect(changesRequests).toBe(1));
    expect(changesTab).toHaveAttribute("aria-selected", "false");
    expect(within(tabs).getByRole("tab", { name: "Details", hidden: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const list = await screen.findByRole("list", {
      name: "Cumulative changed files",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(screen.getByTestId("module-workspace-region").querySelector('[data-pane="tasks"]')).not.toBeNull();
    expect(screen.getByRole("region", { name: "Worktree checkouts" })).toBeVisible();
    expect(screen.getByTestId("changes-checkouts-resize-handle")).toBeVisible();

    expect(screen.getByTestId("changes-workspace")).toHaveClass("min-w-[56rem]");
    expect(screen.getByRole("region", { name: "Selected file diff" })).toBeVisible();
    expect(screen.getByRole("separator", { name: "Resize changed files and diff" })).toBeVisible();
    expect(checkoutRequests).toBe(1);
    fireEvent.click(within(list).getByRole("button", { name: "src/added.ts" }));
    await waitFor(() => expect(diffRequests).toEqual([{ taskId: TASK_ID, path: "src/added.ts" }]));
    expect(await screen.findByText("No textual changes to display.")).toBeVisible();


    const expected = [
      ["src/added.ts", "Added", "text-lifecycle-success"],
      ["src/untracked.ts", "Untracked", "text-lifecycle-success"],
      ["src/modified.ts", "Modified", "text-lifecycle-attention"],
      ["src/deleted.ts", "Deleted", "text-lifecycle-danger"],
      ["src/renamed.ts", "Renamed", "text-text-muted"],
      ["src/copied.ts", "Copied", "text-text-muted"],
      ["src/conflicted.ts", "Conflicted", "text-lifecycle-danger"],
    ] as const;
    for (const [path, label, colorClass] of expected) {
      const row = within(list).getByRole("listitem", { name: new RegExp(path) });
      expect(within(row).getByText(label)).toHaveClass(colorClass);
      expect(row).toHaveAccessibleDescription();
    }

    expect(screen.getByText("7 cumulative changes")).toBeVisible();
    expect(screen.getByText("Includes committed work from the recorded base.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
    expect(within(tabs).getByRole("tab", { name: "Changes" })).toBeVisible();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    await waitFor(() => expect(changesRequests).toBe(2));

    expect(
      studioApolloClient().readQuery({
        query: WorktreeChangesDocument,
        variables: { taskId: TASK_ID },
      }),
    ).toEqual({ worktree_changes: cumulativeChanges });
  });

  it("[overhaul-271] scrolls a long task Changes page through one workspace owner", async () => {
    const http = fixture();
    const longChanges = {
      ...cumulativeChanges,
      truncated: true,
      files: Array.from({ length: 80 }, (_, index) => ({
        __typename: "ChangedFile",
        path: `src/long-list/file-${String(index + 1).padStart(2, "0")}.ts`,
        status: "modified",
        previous_path: null,
      })),
    };
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Scroll cumulative task-worktree changes",
        parent_id: "module-1",
        sequence_id: 1465,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: <SelectedTicket />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: longChanges } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));

    const page = await screen.findByTestId("task-worktree-changes");
    const pane = page.closest<HTMLElement>('[aria-label="Changes workspace"]');
    expect(pane).not.toBeNull();
    const list = within(page).getByRole("list", {
      name: "Cumulative changed files",
    });
    const rows = within(list).getAllByRole("listitem");
    const lastRow = rows.at(-1)!;
    const declaredVerticalOwnersThroughPane = (node: HTMLElement) => {
      const owners: HTMLElement[] = [];
      for (
        let candidate = node.parentElement;
        candidate;
        candidate = candidate.parentElement
      ) {
        if (
          [
            "overflow-auto",
            "overflow-y-auto",
            "overflow-scroll",
            "overflow-y-scroll",
          ].some((className) => candidate.classList.contains(className))
        ) {
          owners.push(candidate);
        }
        if (candidate === pane) break;
      }
      return owners;
    };

    const summary = within(page).getByText("80 cumulative changes");
    expect(declaredVerticalOwnersThroughPane(summary)).toEqual([]);
    const [fileListOwner] = declaredVerticalOwnersThroughPane(lastRow);
    expect(fileListOwner).toHaveClass("overflow-auto");
    expect(summary).toBeVisible();
    expect(within(page).getByLabelText("Changes commands")).toBeVisible();
    expect(within(page).getByLabelText("Worktree cleanup status")).toBeVisible();
    expect(within(page).getByText(/changed-file limit was reached/)).toBeVisible();
    expect(rows).toHaveLength(80);
    expect(lastRow).toHaveAccessibleName(/file-80\.ts: Modified/);
    expect(list.lastElementChild).toBe(lastRow);
    expect(within(page).getByTestId("changes-workspace")).toBeVisible();
    expect(pane).toContainElement(page);
    expect(pane).not.toContainElement(tabs);
  });

  it("[overhaul-185] restores Details when a worktree disappears and explains non-list states", async () => {
    const http = fixture();
    let worktreeStatus = activeCleanWorktree;
    let changesResult: "empty" | "truncated" | "error" = "empty";
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Show cumulative task-worktree changes",
        parent_id: "module-1",
        sequence_id: 1321,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: worktreeStatus } as never;
        }
        if (operation === "WorktreeChanges") {
          if (changesResult === "error") {
            throw new FoundationGraphQlError(
              "storage_unavailable",
              "Git changes are temporarily unavailable.",
            );
          }
          return {
            worktree_changes: {
              ...cumulativeChanges,
              truncated: changesResult === "truncated",
              files:
                changesResult === "truncated"
                  ? cumulativeChanges.files.slice(0, 1)
                  : [],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));
    expect(
      await screen.findByText("No cumulative changes from the recorded base."),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
    await waitFor(() =>
      expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    changesResult = "truncated";
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    const truncationNotice = await screen.findByText("The changed-file limit was reached.");
    expect(truncationNotice).toHaveTextContent("The changed-file limit was reached.");

    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
    await waitFor(() =>
      expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    changesResult = "error";
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Git changes are temporarily unavailable.",
    );

    worktreeStatus = {
      ...activeCleanWorktree,
      kind: "none",
      state: "discarded",
      checkout_present: false,
    };
    await act(async () => {
      await studioApolloClient().refetchQueries({
        include: [WorktreeStatusDocument],
      });
    });

    await waitFor(() =>
      expect(within(tabs).queryByRole("tab", { name: "Changes" })).toBeNull(),
    );
    expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useClientStore.getState().workspaces[TASK_ID]?.active).toBe("details");
    expect(readStudioWorkspaceTarget(TASK_ID)).toBeNull();

    worktreeStatus = activeCleanWorktree;
    changesResult = "empty";
    await act(async () => {
      await studioApolloClient().refetchQueries({
        include: [WorktreeStatusDocument],
      });
    });

    const recreatedChangesTab = await within(tabs).findByRole("tab", {
      name: "Changes",
    });
    expect(recreatedChangesTab).toHaveAttribute("aria-selected", "false");
    expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Issue details")).toBeVisible();
  });

  it.each(["none", "no_repo"] as const)(
    "[overhaul-205] clears a cold Changes restoration when status resolves %s",
    async (initialKind) => {
      const http = fixture();
      let worktreeStatus = {
        ...activeCleanWorktree,
        kind: initialKind as string,
        state: initialKind as string,
        checkout_present: false,
      };
      http.tree("module-1", {
        rootIds: [TASK_ID],
        children: { [TASK_ID]: [] },
        order: [TASK_ID],
      });
      http.workItems([
        workItem({
          id: TASK_ID,
          name: "Show cumulative task-worktree changes",
          parent_id: "module-1",
          sequence_id: 1321,
        }),
      ]);
      useClientStore.getState().resetWorkspaces();
      useClientStore.getState().ensureWorkspace(TASK_ID);
      useClientStore.getState().setActive(TASK_ID, "changes");
      rememberStudioWorkspaceTarget(TASK_ID, { kind: "changes" });

      mountStudio({
        http,
        selectedTaskId: TASK_ID,
        children: (
          <SelectedTicketContent
            bucket={TASK_ID}
            projectId="project-1"
            moduleId="module-1"
            owner="studio"
            details={<div>Issue details</div>}
          />
        ),
        graphQlExecute: async (document, variables) => {
          if (documentOperationName(document) === "WorktreeStatus") {
            return { worktree_status: worktreeStatus } as never;
          }
          return http.executeGraphQl(document, variables);
        },
      });

      const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
      await waitFor(() =>
        expect(useClientStore.getState().workspaces[TASK_ID]?.active).toBe(
          "details",
        ),
      );
      expect(readStudioWorkspaceTarget(TASK_ID)).toEqual({ kind: "details" });
      expect(within(tabs).queryByRole("tab", { name: "Changes" })).toBeNull();

      worktreeStatus = activeCleanWorktree;
      await act(async () => {
        await studioApolloClient().refetchQueries({
          include: [WorktreeStatusDocument],
        });
      });

      const changesTab = await within(tabs).findByRole("tab", {
        name: "Changes",
      });
      expect(changesTab).toHaveAttribute("aria-selected", "false");
      expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    },
  );

  it("[overhaul-190] keeps task Commit and Push independent and excludes dirty work from Push", async () => {
    const http = fixture();
    const commands: Array<{ operation: string; variables: unknown }> = [];
    let changes = {
      ...cumulativeChanges,
      clean: false,
      dirty: true,
      unpushed_count: 2,
    };
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1323 }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: { ...activeCleanWorktree, clean: false, dirty: true } } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreePush") {
          commands.push({ operation, variables });
          changes = { ...changes, unpushed_count: 0 };
          return {
            worktree_push: {
              operation_id: (variables as { operationId: string }).operationId,
              head_commit: "push-head",
              dirty: true,
              unpushed_count: 0,
              uncommitted_work_excluded: true,
            },
          } as never;
        }
        if (operation === "WorktreeCommit") {
          commands.push({ operation, variables });
          changes = { ...changes, clean: true, dirty: false, unpushed_count: 1 };
          return {
            worktree_commit: {
              operation_id: (variables as { operationId: string }).operationId,
              subject: "Record current work",
              message_source: "claude",
              head_commit: "commit-head",
              dirty: false,
              unpushed_count: 1,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));
    const commit = await screen.findByRole("button", { name: "Commit" });
    const push = screen.getByRole("button", { name: "Push" });
    expect(commit).toBeEnabled();
    expect(push).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Push sends committed work only. Uncommitted changes stay local.",
    );

    fireEvent.click(push);
    await waitFor(() => expect(push).toBeDisabled());
    expect(commit).toBeEnabled();
    expect(changes.dirty).toBe(true);

    fireEvent.click(commit);
    await waitFor(() => expect(commit).toBeDisabled());
    expect(push).toBeEnabled();
    expect(commands.map(({ operation }) => operation)).toEqual([
      "WorktreePush",
      "WorktreeCommit",
    ]);
    expect(commands[0].variables).toMatchObject({ taskId: TASK_ID });
    expect(commands[1].variables).toMatchObject({
      taskId: TASK_ID,
      operationId: expect.any(String),
    });
  });

  it("[overhaul-192] creates a task pull request, pushes committed work first, and replaces Create PR with Open PR", async () => {
    const http = fixture();
    const commands: Array<{ operation: string; variables: unknown }> = [];
    let changes = {
      ...cumulativeChanges,
      clean: false,
      dirty: true,
      unpushed_count: 2,
      committed_count: 3,
      pull_request_url: null as string | null,
      pull_request_creation_eligible: true,
    };
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1324 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: { ...activeCleanWorktree, clean: false, dirty: true } } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreeCommitPush") {
          commands.push({ operation, variables });
          return {
            worktree_commit_push: {
              operation_id: (variables as { operationId: string }).operationId,
              subject: "Committed task work",
              message_source: "generated",
              head_commit: "abcdef0123456789abcdef0123456789abcdef01",
              dirty: false,
              unpushed_count: 0,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        if (operation === "WorktreeCreatePullRequest") {
          commands.push({ operation, variables });
          changes = {
            ...changes,
            unpushed_count: 0,
            pull_request_url: "https://github.com/ticketry-hq/ticketry/pull/1324",
            pull_request_creation_eligible: false,
          };
          return {
            worktree_pull_request_create: {
              operation_id: (variables as { operationId: string }).operationId,
              url: changes.pull_request_url,
              title: "Merge 2 commits from wt/CODING-1324-create-pr",
              body: "Merging `wt/CODING-1324-create-pr` into `main`.",
              message_source: "claude",
              branch: "wt/CODING-1324-create-pr",
              base_branch: "main",
              pushed: true,
              uncommitted_work_excluded: true,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Commit, push & create PR" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const open = await screen.findByRole("link", { name: "Open PR" });
    expect(open).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/1324",
    );
    expect(screen.queryByRole("button", { name: "Create PR" })).toBeNull();
    expect(commands.map(({ operation }) => operation)).toEqual([
      "WorktreeCommitPush",
      "WorktreeCreatePullRequest",
    ]);
    expect(commands.every(({ variables }) => (
      variables as { taskId: string }
    ).taskId === TASK_ID)).toBe(true);
  });

  it("[overhaul-193] keeps task Create PR retryable when GitHub rejects the request", async () => {
    const http = fixture();
    const changes = {
      ...cumulativeChanges,
      pull_request_url: null,
      pull_request_creation_eligible: true,
    };
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1324 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreeMergePreview") {
          return { worktree_merge_preview: unavailableMergePreview() } as never;
        }
        if (operation === "WorktreeMergeRecovery") {
          return { worktree_merge_recovery: null } as never;
        }
        if (operation === "WorktreeCreatePullRequest") {
          throw new FoundationGraphQlError(
            "storage_unavailable",
            "GitHub rejected the pull-request request.",
          );
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create PR" }));
    expect(await screen.findByText("GitHub rejected the pull-request request.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByRole("button", { name: "Create PR" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Open PR" })).toBeNull();
  });

  it("[overhaul-194] requires committed task work before offering Create PR", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1324 })]);
    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return {
            worktree_changes: {
              ...cumulativeChanges,
              files: [],
              committed_count: 0,
              pull_request_creation_eligible: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(await within(tabs).findByRole("tab", { name: "Changes" }));
    await screen.findByText("No cumulative changes from the recorded base.");
    expect(screen.queryByRole("button", { name: "Create PR" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open PR" })).toBeNull();
  });

  it("[overhaul-197] presents every mapped pull-request state with only its safe actions", async () => {
    const http = fixture();
    const url = "https://github.com/ticketry-hq/ticketry/pull/1324";
    let changes = {
      ...cumulativeChanges,
      pull_request_url: url,
      pull_request_creation_eligible: false,
      pull_request: {
        ...cumulativeChanges.pull_request,
        url,
        state: "ready",
        target_branch: "main",
        head_commit: "abcdef0123456789abcdef0123456789abcdef01",
      },
    };
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1325 })]);
    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    const changesTab = within(tabs).getByRole("tab", { name: "Changes" });
    fireEvent.click(changesTab);

    const cases = [
      ["ready", "Ready to merge", false, false, false],
      ["merge_conflict", "Merge conflicts", false, false, true],
      ["checks_failed", "Required checks failed", false, false, true],
      ["checks_pending", "Required checks pending", false, false, false],
      ["approval_required", "Human approval required", false, false, false],
      ["mergeability_pending", "Mergeability pending", false, false, false],
      ["wrong_base", "Wrong target branch", false, false, false],
      ["merged", "Merged", false, false, false],
      ["closed_unmerged", "Closed without merge", true, false, false],
      ["unavailable", "Pull request status unavailable", false, false, false],
    ] as const;

    for (const [state, label, replace, followUp, prepare] of cases) {
      changes = {
        ...changes,
        pull_request: {
          ...changes.pull_request,
          state,
          replacement_eligible: replace,
          follow_up_eligible: followUp,
          merge_preparation_eligible: prepare,
          reason: state === "unavailable" ? "GitHub pull-request status is unavailable." : null,
        },
      };
      fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
      fireEvent.click(changesTab);
      await waitFor(() =>
        expect(screen.getByLabelText("Pull request status")).toHaveTextContent(label),
      );
      expect(screen.queryByRole("button", { name: "Replace PR" }) !== null).toBe(replace);
      expect(screen.queryByRole("button", { name: "Create follow-up PR" }) !== null).toBe(followUp);
      if (state === "unavailable") {
        expect(screen.getByRole("link", { name: "Open PR" })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Create PR" })).not.toBeInTheDocument();
      }
      const status = screen.getByLabelText("Pull request status");
      if (prepare) {
        expect(status).toHaveTextContent("Merge preparation available");
        expect(screen.getByRole("button", { name: "Prepare merge" })).toBeEnabled();
      } else {
        expect(status).not.toHaveTextContent("Merge preparation available");
        expect(screen.queryByRole("button", { name: "Prepare merge" })).not.toBeInTheDocument();
      }
    }

    changes = {
      ...changes,
      pull_request: {
        ...changes.pull_request,
        state: "merged",
        post_merge_work: true,
        follow_up_eligible: true,
        reason: null,
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
    fireEvent.click(changesTab);
    expect(await screen.findByRole("button", { name: "Create follow-up PR" })).toBeEnabled();
  });

  it("[overhaul-198] replaces closed pull requests and creates explicit follow-ups", async () => {
    const http = fixture();
    const commands: string[] = [];
    let changes = {
      ...cumulativeChanges,
      pull_request_url: "https://github.com/ticketry-hq/ticketry/pull/1324",
      pull_request_creation_eligible: false,
      pull_request: {
        ...cumulativeChanges.pull_request,
        url: "https://github.com/ticketry-hq/ticketry/pull/1324",
        state: "closed_unmerged",
        target_branch: "main",
        replacement_eligible: true,
      },
    };
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1325 })]);
    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreeReplacePullRequest") {
          commands.push(operation);
          const url = "https://github.com/ticketry-hq/ticketry/pull/1325";
          changes = {
            ...changes,
            pull_request_url: url,
            pull_request: {
              ...changes.pull_request,
              url,
              state: "ready",
              replacement_eligible: false,
            },
          };
          return {
            worktree_pull_request_replace: {
              operation_id: (variables as { operationId: string }).operationId,
              url,
              title: "Merge 1 commit from wt/CODING-1325-replace-pr",
              body: "Merging `wt/CODING-1325-replace-pr` into `main`.",
              message_source: "claude",
              branch: activeCleanWorktree.branch,
              base_branch: "main",
              pushed: false,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        if (operation === "WorktreeFollowUpPullRequest") {
          commands.push(operation);
          const url = "https://github.com/ticketry-hq/ticketry/pull/1326";
          changes = {
            ...changes,
            pull_request_url: url,
            pull_request: {
              ...changes.pull_request,
              url,
              state: "ready",
              post_merge_work: false,
              follow_up_eligible: false,
            },
          };
          return {
            worktree_pull_request_follow_up: {
              operation_id: (variables as { operationId: string }).operationId,
              url,
              title: "Merge 1 commit from wt/CODING-1326-follow-up",
              body: "Merging `wt/CODING-1326-follow-up` into `main`.",
              message_source: "claude",
              branch: activeCleanWorktree.branch,
              base_branch: "main",
              pushed: true,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace PR" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute(
        "href",
        "https://github.com/ticketry-hq/ticketry/pull/1325",
      ),
    );

    changes = {
      ...changes,
      pull_request: {
        ...changes.pull_request,
        state: "merged",
        post_merge_work: true,
        follow_up_eligible: true,
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create follow-up PR" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Open PR" })).toHaveAttribute(
        "href",
        "https://github.com/ticketry-hq/ticketry/pull/1326",
      ),
    );
    expect(commands).toEqual([
      "WorktreeReplacePullRequest",
      "WorktreeFollowUpPullRequest",
    ]);
  });

  it("[overhaul-199] launches merge preparation only after a click and reports launch refusal", async () => {
    const http = fixture();
    const url = "https://github.com/ticketry-hq/ticketry/pull/1327";
    const operations: Array<{ taskId: string; operationId: string }> = [];
    let refuse = false;
    const changes = {
      ...cumulativeChanges,
      pull_request_url: url,
      pull_request_creation_eligible: false,
      pull_request: {
        ...cumulativeChanges.pull_request,
        url,
        state: "merge_conflict",
        target_branch: "main",
        head_commit: "abcdef0123456789abcdef0123456789abcdef01",
        merge_preparation_eligible: true,
      },
    };
    http.tree("module-1", {
      rootIds: [OWNER_ID],
      children: { [OWNER_ID]: [TASK_ID], [TASK_ID]: [] },
      order: [OWNER_ID, TASK_ID],
    });
    http.workItems([
      workItem({ id: OWNER_ID, parent_id: "module-1", sequence_id: 1326 }),
      workItem({ id: TASK_ID, parent_id: OWNER_ID, sequence_id: 1327 }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreeMergePreview") {
          return { worktree_merge_preview: unavailableMergePreview() } as never;
        }
        if (operation === "WorktreeMergeRecovery") {
          return { worktree_merge_recovery: null } as never;
        }
        if (operation === "WorktreeMergePreparation") {
          const input = variables as { taskId: string; operationId: string };
          operations.push(input);
          if (refuse) {
            throw new FoundationGraphQlError(
              "unknown",
              "Merge preparation is no longer available for this pull request.",
            );
          }
          return {
            worktree_pull_request_merge_prepare: {
              operation_id: input.operationId,
              top_level_task_id: OWNER_ID,
              agent_run_id: "merge-preparation-run",
              agent: "codex",
              branch: activeCleanWorktree.branch,
              pull_request_url: url,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    const action = await screen.findByRole("button", { name: "Prepare merge" });
    expect(operations).toHaveLength(0);

    fireEvent.click(action);
    await waitFor(() => expect(operations).toHaveLength(1));
    expect(operations[0]?.taskId).toBe(TASK_ID);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Merge-preparation agent started.",
    );

    refuse = true;
    fireEvent.click(screen.getByRole("button", { name: "Prepare merge" }));
    expect(await screen.findByText(
      "Merge preparation is no longer available for this pull request.",
    )).toHaveAttribute("role", "alert");
    expect(operations).toHaveLength(2);
  });

  it("[overhaul-314] defaults to the origin and searches recent destinations without a Git write", async () => {
    const http = fixture();
    const previews: Array<{ taskId: string; destinationBranch?: string | null }> = [];
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1892 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: cumulativeChanges } as never;
        }
        if (operation === "WorktreeMergePreview") {
          const input = variables as { taskId: string; destinationBranch?: string | null };
          previews.push(input);
          return {
            worktree_merge_preview: {
              __typename: "WorktreeMergePreviewView",
              source_branch: "wt/CODING-1892-merge-preview",
              source_commit: "1111111111111111111111111111111111111111",
              destination_branch: input.destinationBranch ?? "release/2.1",
              destination_commit: "2222222222222222222222222222222222222222",
              destination_checkout: input.destinationBranch === "main" ? "/repos/ticketry" : "/repos/ticketry-release",
              destination_checkout_identity: "release-checkout",
              confirmation_token: "selected-confirmation",
              ready: true,
              blocker: null,
              reason: null,
              requires_destination_selection: false,
              recovery: null,
              destinations: [
                { __typename: "WorktreeMergeDestinationView", branch: "main", checkout: "/repos/ticketry" },
                { __typename: "WorktreeMergeDestinationView", branch: "release/2.1", checkout: "/repos/ticketry-release" },
                { __typename: "WorktreeMergeDestinationView", branch: "backup/old", checkout: null },
                { __typename: "WorktreeMergeDestinationView", branch: "wt/CODING-1892-merge-preview", checkout: "/repos/task-worktree" },
              ],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));

    const preview = await screen.findByRole("region", { name: "Local merge preview" });
    expect(preview).toHaveTextContent("wt/CODING-1892-merge-preview");
    const picker = within(preview).getByRole("combobox", { name: "Local merge destination" });
    expect(picker).toHaveValue("release/2.1");
    expect(within(preview).queryByRole("button", { name: "Preview destination" })).not.toBeInTheDocument();
    expect(previews).toEqual([{ taskId: TASK_ID, destinationBranch: null }]);
    expect(await screen.findByText("Ready to merge locally")).toBeVisible();
    const selectedPreview = screen.getByRole("region", { name: "Local merge preview" });
    expect(selectedPreview).toHaveTextContent("release/2.1");
    expect(selectedPreview).toHaveTextContent("/repos/ticketry-release");
    fireEvent.focus(picker);
    expect(within(preview).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "main/repos/ticketry",
      "release/2.1/repos/ticketry-release",
      "backup/oldNot checked out",
    ]);
    expect(screen.getByRole("option", { name: /release\/2.1/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(picker, { target: { value: "no-such-branch" } });
    expect(screen.getByText("No matching branches")).toBeVisible();
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(picker).toHaveValue("release/2.1");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.change(picker, { target: { value: "MAIN" } });
    expect(within(preview).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "Enter" });
    await waitFor(() => expect(previews.at(-1)).toEqual({ taskId: TASK_ID, destinationBranch: "main" }));
    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeEnabled();
    expect(picker).toHaveValue("main");
    expect(selectedPreview).toHaveTextContent("/repos/ticketry");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("[overhaul-315] binds, runs, and refreshes a confirmed local fast-forward", async () => {
    const http = fixture();
    const sourceCommit = "1111111111111111111111111111111111111111";
    const destinationCommit = "2222222222222222222222222222222222222222";
    const merges: Array<Record<string, string>> = [];
    const reads: string[] = [];
    let reject = true;
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1893 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (["WorktreeStatus", "WorktreeChanges", "ModuleVersionControl", "WorktreeMergePreview"].includes(operation)) {
          reads.push(operation);
        }
        if (operation === "WorktreeStatus") return { worktree_status: activeCleanWorktree } as never;
        if (operation === "WorktreeChanges") return { worktree_changes: cumulativeChanges } as never;
        if (operation === "WorktreeMergePreview") {
          return {
            worktree_merge_preview: {
              __typename: "WorktreeMergePreviewView",
              source_branch: "wt/CODING-1893-fast-forward",
              source_commit: sourceCommit,
              destination_branch: "main",
              destination_commit: destinationCommit,
              destination_checkout: "/repos/ticketry",
              destination_checkout_identity: "main-checkout",
              confirmation_token: "ready-confirmation",
              ready: true,
              blocker: null,
              reason: null,
              requires_destination_selection: false,
              recovery: null,
              destinations: [],
            },
          } as never;
        }
        if (operation === "WorktreeMerge") {
          const input = variables as Record<string, string>;
          merges.push(input);
          if (reject) throw new FoundationGraphQlError("unknown", "The merge response was interrupted. Retry safely.");
          return {
            worktree_merge: {
              __typename: "WorktreeMergeResult",
              operation_id: input.operationId,
              outcome: "fast_forwarded",
              source_branch: "wt/CODING-1893-fast-forward",
              source_commit: sourceCommit,
              destination_branch: input.destinationBranch,
              destination_commit: sourceCommit,
              destination_checkout: "/repos/ticketry",
              unmerged_paths: [],
              finish_ready: false,
              abort_ready: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    const action = await screen.findByRole("button", { name: "Merge into main" });
    fireEvent.click(action);
    await waitFor(() => expect(merges).toHaveLength(1));
    expect(await screen.findByText("The merge response was interrupted. Retry safely.")).toHaveAttribute("role", "alert");
    expect(merges[0]).toMatchObject({
      taskId: TASK_ID,
      destinationBranch: "main",
      confirmationToken: "ready-confirmation",
      operationId: expect.any(String),
    });
    await waitFor(() => {
      for (const operation of ["WorktreeStatus", "WorktreeChanges", "WorktreeMergePreview"]) {
        expect(reads.filter((read) => read === operation).length).toBeGreaterThan(1);
      }
    });

    reject = false;
    fireEvent.click(screen.getByRole("button", { name: "Merge into main" }));
    await waitFor(() => expect(merges).toHaveLength(2));
    expect(merges[1]?.operationId).toBe(merges[0]?.operationId);
    expect(await screen.findByText("Fast-forwarded main.")).toBeInTheDocument();
  });

  it("[overhaul-322] refreshes a dirty source preview after Commit and enables Merge", async () => {
    const http = fixture();
    let dirty = true;
    let previewReads = 0;
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1928 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: { ...activeCleanWorktree, clean: !dirty, dirty } } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: { ...cumulativeChanges, clean: !dirty, dirty } } as never;
        }
        if (operation === "WorktreeMergePreview") {
          previewReads += 1;
          return {
            worktree_merge_preview: {
              __typename: "WorktreeMergePreviewView",
              source_branch: "wt/CODING-1928-refresh-preview",
              source_commit: "1111111111111111111111111111111111111111",
              destination_branch: "main",
              destination_commit: "2222222222222222222222222222222222222222",
              destination_checkout: "/repos/ticketry",
              destination_checkout_identity: "main-checkout",
              confirmation_token: dirty ? null : "clean-source-confirmation",
              ready: !dirty,
              blocker: dirty ? "source_dirty" : null,
              reason: dirty ? "Commit or discard source work before merging." : null,
              requires_destination_selection: false,
              recovery: null,
              destinations: [],
            },
          } as never;
        }
        if (operation === "WorktreeMergeRecovery") {
          return { worktree_merge_recovery: null } as never;
        }
        if (operation === "WorktreeCommit") {
          dirty = false;
          return {
            worktree_commit: {
              operation_id: (variables as { operationId: string }).operationId,
              subject: "Make source mergeable",
              message_source: "generated",
              head_commit: "1111111111111111111111111111111111111111",
              dirty: false,
              unpushed_count: 1,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("Commit or discard source work before merging.")).toHaveAttribute("role", "alert");
    expect(screen.queryByRole("button", { name: "Merge into main" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeEnabled();
    expect(previewReads).toBeGreaterThan(1);
  });

  it("[overhaul-323] refreshes merge eligibility after an external destination fix", async () => {
    const http = fixture();
    let destinationBlocked = true;
    let previewReads = 0;
    http.tree("module-1", { rootIds: [TASK_ID], children: { [TASK_ID]: [] }, order: [TASK_ID] });
    http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1928 })]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      children: (
        <SelectedTicketContent
          bucket={TASK_ID}
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          return { worktree_status: activeCleanWorktree } as never;
        }
        if (operation === "WorktreeChanges") {
          return { worktree_changes: cumulativeChanges } as never;
        }
        if (operation === "WorktreeMergePreview") {
          previewReads += 1;
          return {
            worktree_merge_preview: {
              __typename: "WorktreeMergePreviewView",
              source_branch: "wt/CODING-1928-refresh-preview",
              source_commit: "1111111111111111111111111111111111111111",
              destination_branch: "release/2.1",
              destination_commit: "2222222222222222222222222222222222222222",
              destination_checkout: destinationBlocked ? null : "/repos/ticketry-release",
              destination_checkout_identity: destinationBlocked ? null : "release-checkout",
              confirmation_token: destinationBlocked ? null : "destination-fixed-confirmation",
              ready: !destinationBlocked,
              blocker: destinationBlocked ? "destination_checkout_missing" : null,
              reason: destinationBlocked
                ? "Check out release/2.1, then refresh merge eligibility."
                : null,
              requires_destination_selection: false,
              recovery: null,
              destinations: [],
            },
          } as never;
        }
        if (operation === "WorktreeMergeRecovery") {
          return { worktree_merge_recovery: null } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    expect(await screen.findByText("Check out release/2.1, then refresh merge eligibility.")).toHaveAttribute("role", "alert");

    destinationBlocked = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh merge eligibility" }));

    expect(await screen.findByRole("button", { name: "Merge into release/2.1" })).toBeEnabled();
    expect(previewReads).toBeGreaterThan(1);
  });
});

function unavailableMergePreview() {
  return {
    __typename: "WorktreeMergePreviewView",
    source_branch: activeCleanWorktree.branch,
    source_commit: null,
    destination_branch: null,
    destination_commit: null,
    destination_checkout: null,
    destination_checkout_identity: null,
    confirmation_token: null,
    ready: false,
    blocker: "unavailable",
    reason: null,
    requires_destination_selection: false,
    destinations: [],
  };
}
