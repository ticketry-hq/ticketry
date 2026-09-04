import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "selected-task";
const CHILD_ID = "shared-child";
const NEW_PARENT_ID = "new-parent";
const LONG_BRANCH =
  "wt/CODIN-1130-worktree-branch-base-and-path-overflow-the-260px-details-column";
const LONG_BASE_BRANCH =
  "feature/CODIN-1100-bring-back-the-worktrees-in-the-rust-version";
const LONG_CONFLICT_PATH =
  "/Users/karthik/merge_conflicts/coding/ticketry-rust/.ticketry-dev/worktrees/CODIN-1130-worktree-branch-base-and-path-overflow";

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

const sharedChildWithoutWorktree = {
  ...noWorktree,
  task_id: CHILD_ID,
  top_level_task_id: TASK_ID,
  is_shared: true,
};

const sharedChildWorktree = {
  ...activeWorktree,
  task_id: CHILD_ID,
  top_level_task_id: TASK_ID,
  is_shared: true,
};

describe("overhaul acceptance — selected-task Details worktree", () => {
  it("[overhaul-165] keeps one selected Work Item worktree block inside the hideable Details panel", async () => {
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

    const detailsPanel = await screen.findByTestId("details-panel");
    const worktreeBlock = await within(detailsPanel).findByTestId("worktree-block");
    expect(within(detailsPanel).getAllByTestId("worktree-block")).toHaveLength(1);
    expect(detailsPanel).toHaveClass("overflow-y-auto");
    expect(
      within(detailsPanel)
        .getByTestId("details-fields")
        .compareDocumentPosition(worktreeBlock),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      await within(worktreeBlock).findByText("Runs in the primary checkout."),
    ).toBeVisible();
    expect(
      within(worktreeBlock).getByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([{ taskId: TASK_ID }]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide details panel" }));
    expect(screen.queryByTestId("details-panel")).toBeNull();
    expect(screen.queryByTestId("worktree-block")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show details panel" }));
    const restoredPanel = await screen.findByTestId("details-panel");
    expect(within(restoredPanel).getAllByTestId("worktree-block")).toHaveLength(1);
    expect(
      await within(restoredPanel).findByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();
  }, 10_000);

  it("[overhaul-166] follows task selection without leaking worktree confirmation or mutation errors", async () => {
    const http = fixture();
    const worktreeRequests: string[] = [];
    let discardRequests = 0;
    let rejectDiscard!: (reason?: unknown) => void;
    const pendingDiscard = new Promise<never>((_resolve, reject) => {
      rejectDiscard = reject;
    });
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
              taskId === CHILD_ID ? sharedChildWithoutWorktree : activeWorktree,
          } as never;
        }
        if (operation === "WorktreeDiscard") {
          discardRequests += 1;
          return pendingDiscard;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));
    expect(screen.getByText("Discard — work is thrown away?")).toBeVisible();
    await waitFor(() => expect(discardRequests).toBe(1));

    const stories = screen.getByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("button", { name: "Expand subtasks" }),
    );
    fireEvent.click(
      await within(stories).findByRole("treeitem", {
        name: /Shared implementation child/,
      }),
    );

    const details = await screen.findByTestId("details-panel");
    expect(
      await within(details).findByText("Runs in the primary checkout."),
    ).toBeVisible();
    expect(within(details).queryByText("Discard failed")).toBeNull();
    expect(
      within(details).queryByText("Discard — work is thrown away?"),
    ).toBeNull();
    expect(
      within(details).getByRole("button", { name: "+ Create worktree" }),
    ).toBeEnabled();
    expect(
      within(details).queryByText(
        `Shares the worktree owned by top-level task (${TASK_ID}).`,
      ),
    ).toBeNull();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([TASK_ID, CHILD_ID]),
    );

    await act(async () => {
      rejectDiscard(new Error("discard rejected"));
      await pendingDiscard.catch(() => undefined);
    });
    expect(within(details).queryByText("Discard failed")).toBeNull();
    expect(
      within(details).getByRole("button", { name: "+ Create worktree" }),
    ).toBeEnabled();
  }, 10_000);

  it("[overhaul-170] contains long worktree branches and conflict paths inside the Details column", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [CHILD_ID], [CHILD_ID]: [] },
      order: [TASK_ID, CHILD_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Long worktree branch",
        parent_id: "module-1",
        sequence_id: 1130,
        sub_issues_count: 1,
      }),
      workItem({
        id: CHILD_ID,
        name: "Conflicted worktree path",
        parent_id: TASK_ID,
        sequence_id: 1131,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeStatus") {
          const taskId = (variables as { taskId: string }).taskId;
          return {
            worktree_status:
              taskId === CHILD_ID
                ? {
                    ...activeWorktree,
                    task_id: CHILD_ID,
                    is_shared: true,
                    branch: LONG_BRANCH,
                    base_branch: LONG_BASE_BRANCH,
                    path: LONG_CONFLICT_PATH,
                    state: "conflict",
                    conflict: true,
                  }
                : {
                    ...activeWorktree,
                    branch: LONG_BRANCH,
                    base_branch: LONG_BASE_BRANCH,
                  },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const details = await screen.findByTestId("details-panel");
    expect(details.parentElement).toHaveClass("grid-cols-[1fr_260px]");
    expect(await within(details).findByTestId("worktree-block")).toHaveClass(
      "min-w-0",
    );
    expect(
      await within(details).findByText(`${LONG_BRANCH} → ${LONG_BASE_BRANCH}`),
    ).toHaveClass("min-w-0", "break-all");

    const stories = screen.getByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("button", { name: "Expand subtasks" }),
    );
    fireEvent.click(
      await within(stories).findByRole("treeitem", {
        name: /Conflicted worktree path/,
      }),
    );

    expect(await within(details).findByText("Conflict")).toBeVisible();
    expect(
      within(details).getByText(
        `Shares the worktree owned by top-level task (${TASK_ID}).`,
      ),
    ).toBeVisible();
    expect(
      within(details).getByText("in the worktree"),
    ).toBeVisible();
    expect(
      within(details).getByText(/Re-marking the task Done retries/),
    ).toBeVisible();
    expect(within(details).getByText(LONG_CONFLICT_PATH)).toHaveClass(
      "min-w-0",
      "break-all",
    );
    expect(
      within(details).queryByRole("button", { name: "Discard" }),
    ).toBeNull();
  });

  it("[overhaul-183] shows shared worktree ownership for a child in production Details", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [CHILD_ID], [CHILD_ID]: [] },
      order: [TASK_ID, CHILD_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Top-level worktree owner",
        parent_id: "module-1",
        sequence_id: 1172,
        sub_issues_count: 1,
      }),
      workItem({
        id: CHILD_ID,
        name: "Child sharing the owner's worktree",
        parent_id: TASK_ID,
        sequence_id: 1173,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: CHILD_ID,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeStatus") {
          expect(variables).toEqual({ taskId: CHILD_ID });
          return { worktree_status: sharedChildWorktree } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const details = await screen.findByTestId("details-panel");
    expect(
      await within(details).findByText(
        `Shares the worktree owned by top-level task (${TASK_ID}).`,
      ),
    ).toBeVisible();
    expect(
      within(details).queryByRole("button", { name: "Discard" }),
    ).toBeNull();
  });

  it("[overhaul-171] keeps discard confirmation open when the same task is reparented", async () => {
    const http = fixture();
    const worktreeRequests: string[] = [];
    http.tree("module-1", {
      rootIds: [TASK_ID, NEW_PARENT_ID],
      children: { [TASK_ID]: [], [NEW_PARENT_ID]: [] },
      order: [TASK_ID, NEW_PARENT_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Task with an open discard confirmation",
        parent_id: "module-1",
        sequence_id: 1131,
      }),
      workItem({
        id: NEW_PARENT_ID,
        name: "New parent",
        parent_id: "module-1",
        sequence_id: 1132,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeStatus") {
          worktreeRequests.push((variables as { taskId: string }).taskId);
          return { worktree_status: activeWorktree } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(screen.getByText("Discard — work is thrown away?")).toBeVisible();

    const reparented = http.expectPatch(TASK_ID, {
      parent_id: NEW_PARENT_ID,
    });
    const details = await screen.findByTestId("details-panel");
    fireEvent.click(
      within(within(details).getByTestId("parent-picker")).getByRole("button"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /New parent/ }),
    );
    await reparented;

    expect(
      within(details).getByText("Discard — work is thrown away?"),
    ).toBeVisible();
    expect(worktreeRequests).toEqual([TASK_ID]);
  });

  it("[overhaul-181] shows an owner's worktree after it is created from a child", async () => {
    const http = fixture();
    const worktreeRequests: string[] = [];
    let hasWorktree = false;
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
        sequence_id: 1170,
        sub_issues_count: 1,
      }),
      workItem({
        id: CHILD_ID,
        name: "Child creating the shared worktree",
        parent_id: TASK_ID,
        sequence_id: 1171,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: TASK_ID,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        const taskId = (variables as { taskId: string }).taskId;
        if (operation === "WorktreeStatus") {
          worktreeRequests.push(`status:${taskId}`);
          return {
            worktree_status: taskId === CHILD_ID
              ? hasWorktree
                ? sharedChildWorktree
                : sharedChildWithoutWorktree
              : hasWorktree
                ? activeWorktree
                : noWorktree,
          } as never;
        }
        if (operation === "WorktreeCreate") {
          worktreeRequests.push(`create:${taskId}`);
          hasWorktree = true;
          return { worktree_create: sharedChildWorktree } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    expect(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();

    const stories = screen.getByRole("region", { name: "Stories" });
    fireEvent.click(
      within(stories).getByRole("button", { name: "Expand subtasks" }),
    );
    fireEvent.click(
      await within(stories).findByRole("treeitem", {
        name: /Child creating the shared worktree/,
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "+ Create worktree" }),
    );
    expect(
      await screen.findByText(
        `Shares the worktree owned by top-level task (${TASK_ID}).`,
      ),
    ).toBeVisible();

    fireEvent.click(
      within(stories).getByRole("treeitem", { name: /Top-level owner/ }),
    );

    expect(
      await screen.findByText("wt/MEML-1118-restore-worktree-controls → main"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard" })).toBeVisible();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([
        `status:${TASK_ID}`,
        `status:${CHILD_ID}`,
        `create:${CHILD_ID}`,
        `status:${TASK_ID}`,
      ]),
    );
  }, 10_000);
});
