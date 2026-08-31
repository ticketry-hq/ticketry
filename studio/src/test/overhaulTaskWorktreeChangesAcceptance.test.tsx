import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
} from "../app/shell/ticket-workspace/selected-ticket/internal/studioWorkspaceTarget";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useClientStore } from "../state/clientStore";
import { WorktreeChangesDocument } from "../features/agents/worktrees/generated/worktreeChanges.documents";
import { WorktreeStatusDocument } from "../features/agents/worktrees/generated/worktreeStatus.documents";
import { fixture, mountStudio, workItem } from "./seam";

const OWNER_ID = "task-worktree-owner";
const TASK_ID = "child-with-committed-work";

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
  })),
};

describe("overhaul acceptance - task worktree Changes", () => {
  it("[overhaul-184] keeps cumulative committed work in a labeled, accessible Changes tab", async () => {
    const http = fixture();
    let changesRequests = 0;
    const savedTabOrders: unknown[] = [];
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
    await waitFor(() => expect(changesRequests).toBe(1));
    await waitFor(() =>
      expect(savedTabOrders).toContainEqual([
        { kind: "details" },
        { kind: "changes" },
      ]),
    );

    fireEvent.click(changesTab);

    const list = await screen.findByRole("list", {
      name: "Cumulative changed files",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(7);

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

    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
    expect(within(tabs).getByRole("tab", { name: "Changes" })).toBeVisible();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    await waitFor(() => expect(changesRequests).toBe(3));

    expect(
      studioApolloClient().readQuery({
        query: WorktreeChangesDocument,
        variables: { taskId: TASK_ID },
      }),
    ).toEqual({ worktree_changes: cumulativeChanges });
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

    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
    await waitFor(() =>
      expect(within(tabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    changesResult = "truncated";
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    const truncationNotice = await screen.findByRole("status");
    expect(truncationNotice).toHaveTextContent("The changed-file limit was reached.");

    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
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
    expect(readStudioWorkspaceTarget(TASK_ID)).toEqual({ kind: "details" });

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
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "Record current work" },
    });
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
      message: "Record current work",
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
    expect(await screen.findByRole("button", { name: "Create PR" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Create PR follows the same rule.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));

    const open = await screen.findByRole("link", { name: "Open PR" });
    expect(open).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/1324",
    );
    expect(screen.queryByRole("button", { name: "Create PR" })).toBeNull();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      operation: "WorktreeCreatePullRequest",
      variables: { taskId: TASK_ID },
    });
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub rejected the pull-request request.",
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
    const details = within(tabs).getByRole("tab", { name: "Details" });
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
      fireEvent.click(details);
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
    fireEvent.click(details);
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
    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Merge preparation is no longer available for this pull request.",
    );
    expect(operations).toHaveLength(2);
  });
});
