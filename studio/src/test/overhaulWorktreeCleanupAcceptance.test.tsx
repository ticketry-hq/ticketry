import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskWorktreeChanges } from "../features/agents/worktrees";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "cleanup-task";
const URL = "https://github.com/ticketry-hq/ticketry/pull/1326";

function mergedChanges(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "WorktreeChangesView",
    task_id: TASK_ID,
    top_level_task_id: TASK_ID,
    is_shared: false,
    base_commit: "0123456789abcdef0123456789abcdef01234567",
    committed_count: 1,
    pull_request_url: URL,
    pull_request_creation_eligible: false,
    work_item_done: true,
    closure_failure: null,
    cleanup: {
      __typename: "WorktreeCleanupStatusView",
      eligible: true,
      blocker: null,
      reason: null,
    },
    pull_request: {
      __typename: "PullRequestStatusView",
      url: URL,
      state: "merged",
      target_branch: "main",
      head_commit: "abcdef0123456789abcdef0123456789abcdef01",
      integrated: true,
      post_merge_work: false,
      replacement_eligible: false,
      follow_up_eligible: false,
      merge_preparation_eligible: false,
      reason: null,
    },
    clean: true,
    dirty: false,
    unpushed_count: 0,
    truncated: false,
    files: [],
    ...overrides,
  };
}

function cleanupFixture() {
  const http = fixture();
  http.tree("module-1", {
    rootIds: [TASK_ID],
    children: { [TASK_ID]: [] },
    order: [TASK_ID],
  });
  http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1326 })]);
  return http;
}

describe("overhaul acceptance - merged worktree cleanup", () => {
  it.each([
    ["pull_request_absent", "No pull request is mapped to this worktree."],
    ["pull_request_unavailable", "Pull-request status is unavailable, so cleanup cannot be verified."],
    ["pull_request_not_merged", "The mapped pull request has not merged."],
    ["pull_request_closed_unmerged", "The mapped pull request closed without merging."],
    ["pull_request_wrong_base", "The mapped pull request did not merge into the recorded base."],
    ["work_item_not_done", "The owning Work Item must reach Done before cleanup."],
    ["checkout_dirty", "Uncommitted work must be resolved before cleanup."],
    ["post_merge_work", "New branch work exists after the merged pull request."],
  ])("[overhaul-200] explains cleanup blocker %s without offering removal", async (blocker, reason) => {
    const http = cleanupFixture();
    const closureFailure = blocker === "work_item_not_done"
      ? {
          __typename: "WorkItemClosureFailureView",
          code: "human_only_transition",
          message: "This workflow edge is human-only; agents are not allowed to take it.",
          from_state: "Review",
          to_state: "Done",
        }
      : null;
    mountStudio({
      http,
      children: <TaskWorktreeChanges taskId={TASK_ID} active />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "WorktreeChanges") {
          return {
            worktree_changes: mergedChanges({
              work_item_done: blocker !== "work_item_not_done",
              closure_failure: closureFailure,
              cleanup: {
                __typename: "WorktreeCleanupStatusView",
                eligible: false,
                blocker,
                reason,
              },
            }),
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    expect(await screen.findByLabelText("Worktree cleanup status")).toHaveTextContent(reason);
    expect(screen.queryByRole("button", { name: "Cleanup local worktree" })).toBeNull();
    if (closureFailure) {
      expect(screen.getByLabelText("Work Item closure failure")).toHaveTextContent("human-only");
      expect(screen.getByLabelText("Pull request status")).toHaveTextContent("Merged");
    }
  });

  it("[overhaul-201] confirms cleanup and keeps a failed partial operation retryable", async () => {
    const http = cleanupFixture();
    const operations: Array<{ operationId: string; confirmed: boolean }> = [];
    let fail = true;
    mountStudio({
      http,
      children: <TaskWorktreeChanges taskId={TASK_ID} active />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "WorktreeChanges") {
          return { worktree_changes: mergedChanges() } as never;
        }
        if (operation === "WorktreeCleanup") {
          const input = variables as { operationId: string; confirmed: boolean };
          operations.push(input);
          if (fail) {
            fail = false;
            throw new FoundationGraphQlError(
              "unknown",
              "Git removed the checkout but could not delete the local branch. Retry cleanup.",
            );
          }
          return {
            worktree_cleanup: {
              __typename: "WorktreeDiscardResult",
              removed: true,
              task_id: TASK_ID,
              top_level_task_id: TASK_ID,
              branch: "wt/CODING-1326-cleanup",
              reason: null,
              status: {
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
                reason: "no worktree for this Work Item",
              },
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cleanup local worktree" }));
    expect(screen.getByRole("group", { name: "Confirm local worktree cleanup" })).toBeVisible();
    expect(operations).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm cleanup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not delete the local branch");
    expect(operations).toHaveLength(1);
    expect(operations[0]?.confirmed).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cleanup local worktree" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm cleanup" }));
    await waitFor(() => expect(operations).toHaveLength(2));
    expect(operations[1]?.operationId).toBe(operations[0]?.operationId);
    expect(await screen.findByRole("status")).toHaveTextContent("Local worktree cleanup completed.");
  });
});
