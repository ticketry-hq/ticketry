import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "selected-task";
const CHILD_ID = "shared-child";

const noWorktree = {
  __typename: "WorktreeStatusView",
  kind: "none",
  task_id: TASK_ID,
  top_level_task_id: TASK_ID,
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

const activeWorktree = {
  ...noWorktree,
  kind: "worktree",
  branch: "wt/MEML-1118-restore-worktree-controls",
  base_branch: "main",
  path: "/worktrees/MEML-1118-restore-worktree-controls",
  state: "active",
  clean: true,
  dirty: false,
  ahead: 1,
  behind: 0,
  conflict: false,
  checkout_present: true,
};

const sharedChildWorktree = {
  ...activeWorktree,
  task_id: CHILD_ID,
  top_level_task_id: TASK_ID,
  is_shared: true,
};

describe("overhaul acceptance — selected-task Details worktree", () => {
  it("[overhaul-165] keeps Details compact with breadcrumbs above the ordered toolbar", async () => {
    const http = fixture();
    const worktreeRequests: Record<string, unknown>[] = [];
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Restore worktree controls",
        parent_id: "module-1",
        sequence_id: 1118,
      }),
      workItem({
        id: "implement-state-catalog",
        state: { id: "implement", name: "Implement", group: "started", color: null },
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeStatus") {
          worktreeRequests.push(variables as Record<string, unknown>);
          return { worktree_status: noWorktree } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const details = await screen.findByRole("region", { name: "Details" });
    const document = within(details).getByTestId("details-document");
    const fields = within(document).getByTestId("details-fields");
    expect(document).toHaveClass("w-full", "min-w-0", "px-4", "py-2");
    expect(document.className).not.toMatch(/max-w-|mx-auto/);
    expect(within(details).getByTestId("status-row")).toHaveClass("px-4");
    expect(fields).toHaveClass("mt-2", "py-2");
    // The worktree control sits in the toolbar with the run actions.
    const actions = within(details).getByTestId("details-actions");
    const worktreeBlock = await within(actions).findByTestId("worktree-block");
    const runNow = await within(actions).findByRole("button", { name: "Run now" });
    const run = within(actions).getByRole("button", { name: "Run item" });
    const status = within(within(actions).getByTestId("state-picker"))
      .getByRole("button");
    const toolbarButtons = within(actions).getAllByRole("button");
    expect(toolbarButtons.indexOf(status)).toBeLessThan(toolbarButtons.indexOf(run));
    expect(toolbarButtons.indexOf(run)).toBeLessThan(toolbarButtons.indexOf(runNow));
    expect(toolbarButtons.indexOf(runNow)).toBeLessThan(
      toolbarButtons.indexOf(within(worktreeBlock).getByRole("button", { name: "+ Worktree" })),
    );
    expect(toolbarButtons.indexOf(within(worktreeBlock).getByRole("button", { name: "+ Worktree" })))
      .toBeLessThan(toolbarButtons.indexOf(
        within(within(actions).getByTestId("issue-type-picker")).getByRole("button"),
      ));
    expect(toolbarButtons.indexOf(
      within(within(actions).getByTestId("issue-type-picker")).getByRole("button"),
    )).toBeLessThan(toolbarButtons.indexOf(
      within(actions).getByRole("button", { name: "Story workflow guide" }),
    ));
    const statusRow = within(details).getByTestId("status-row");
    const breadcrumb = within(details).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(statusRow).queryByRole("navigation", { name: "Breadcrumb" }))
      .toBeNull();
    expect(breadcrumb.parentElement?.nextElementSibling).toBe(statusRow);
    expect(within(details).getAllByTestId("worktree-block")).toHaveLength(1);
    expect(within(document).queryByTestId("worktree-block")).toBeNull();
    expect(within(details).queryByText("Primary checkout")).toBeNull();
    expect(
      within(worktreeBlock).getByRole("button", { name: "+ Worktree" }),
    ).toBeVisible();
    expect(within(details).getByTestId("status-row")).toBeVisible();
    expect(screen.queryByTestId("details-panel")).toBeNull();
    expect(screen.queryByTestId("issue-sidebar-toggle")).toBeNull();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([{ taskId: TASK_ID }]),
    );
  });

  it("[overhaul-166] follows task selection without leaking worktree confirmation or mutation errors", async () => {
    const http = fixture();
    const worktreeRequests: string[] = [];
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [CHILD_ID], [CHILD_ID]: [] },
      order: [TASK_ID, CHILD_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Top-level owner",
        parent_id: "module-1",
        sequence_id: 1118,
        sub_issues_count: 1,
      }),
      workItem({
        id: CHILD_ID,
        name: "Shared implementation child",
        parent_id: TASK_ID,
        sequence_id: 1119,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeStatus") {
          const taskId = (variables as { taskId: string }).taskId;
          worktreeRequests.push(taskId);
          return {
            worktree_status:
              taskId === CHILD_ID ? sharedChildWorktree : activeWorktree,
          } as never;
        }
        if (operation === "WorktreeDiscard") {
          throw new Error("discard rejected");
        }
        return http.executeGraphQl(document, variables);
      },
    });

    expect(
      await screen.findByRole("button", { name: `View changes on ${activeWorktree.branch}` }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show worktree details" }));
    expect(await screen.findByText(/Completion keeps the worktree/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));
    expect(await screen.findByText("Discard failed")).toBeVisible();
    expect(screen.getByText("Discard — work is thrown away?")).toBeVisible();

    const stories = screen.getByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("button", { name: "Expand subtasks" }),
    );
    fireEvent.click(
      await within(stories).findByRole("treeitem", {
        name: /Shared implementation child/,
      }),
    );

    const details = await screen.findByRole("region", { name: "Details" });
    await waitFor(() => expect(worktreeRequests).toContain(CHILD_ID));
    fireEvent.click(
      await within(details).findByRole("button", { name: "Show worktree details" }),
    );
    expect(
      await within(details).findByText("Shared with its parent work item"),
    ).toBeVisible();
    expect(
      await within(details).findByText(
        `Shares the worktree owned by top-level task (${TASK_ID}).`,
      ),
    ).toBeVisible();
    expect(within(details).queryByText("Discard failed")).toBeNull();
    expect(
      within(details).queryByText("Discard — work is thrown away?"),
    ).toBeNull();
    expect(
      within(details).queryByRole("button", { name: "+ Worktree" }),
    ).toBeNull();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([TASK_ID, CHILD_ID]),
    );

    fireEvent.click(
      within(details).getByRole("button", {
        name: `View changes on ${sharedChildWorktree.branch}`,
      }),
    );
    await waitFor(() =>
      expect(useClientStore.getState().workspaces[CHILD_ID]?.active).toBe("changes"),
    );
  });
});
