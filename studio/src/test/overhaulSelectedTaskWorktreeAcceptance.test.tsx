import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { documentOperationName } from "../graphql-foundation/typedDocument";
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
    expect(within(worktreeBlock).getByText("Runs in the primary checkout.")).toBeVisible();
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
      within(restoredPanel).getByRole("button", { name: "+ Create worktree" }),
    ).toBeVisible();
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

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
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

    const details = await screen.findByTestId("details-panel");
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
      within(details).queryByRole("button", { name: "+ Create worktree" }),
    ).toBeNull();
    await waitFor(() =>
      expect(worktreeRequests).toEqual([TASK_ID, CHILD_ID]),
    );
  });
});
