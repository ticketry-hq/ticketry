import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { describe, expect, it, vi } from "vitest";

import { StudioFooter } from "../app/shell/StudioFooter";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const ORIGIN_TASK_ID = "changes-origin-task";
const REVIEW_TASK_ID = "changes-review-task";

vi.mock("../features/agents/worktrees/changes/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => <div>{patch}</div>,
}));

describe("overhaul acceptance - independent Changes workspace navigation", () => {
  it("[overhaul-332] opens independently and Back restores the exact planning origin", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const http = fixture();
    http.tree("module-1", {
      rootIds: [ORIGIN_TASK_ID, REVIEW_TASK_ID],
      children: { [ORIGIN_TASK_ID]: [], [REVIEW_TASK_ID]: [] },
      order: [ORIGIN_TASK_ID, REVIEW_TASK_ID],
    });
    http.workItems([
      workItem({
        id: ORIGIN_TASK_ID,
        name: "Keep this planning origin",
        parent_id: "module-1",
        sequence_id: 1970,
      }),
      workItem({
        id: REVIEW_TASK_ID,
        name: "Inspect this checkout",
        parent_id: "module-1",
        sequence_id: 1971,
      }),
    ]);
    useClientStore.setState({
      panelLayout: [18, 32, 50],
      sidebarVisible: true,
    });

    mountStudio({
      http,
      selectedTaskId: ORIGIN_TASK_ID,
      children: (
        <>
          <TicketWorkspace
            tasksSize={40}
            workspaceSize={60}
            groupRef={createRef<ImperativePanelGroupHandle>()}
            onLayout={() => {}}
          />
          <StudioFooter />
        </>
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "CurrentWorktrees") {
          return { worktrees: { __typename: "WorktreesConnection", nodes: [{
            __typename: "Worktrees", id: "wt-review", taskId: REVIEW_TASK_ID, branch: "wt/CODING-1971-inspect",
            issue: { __typename: "WorktrackerIssue", id: REVIEW_TASK_ID, sequenceId: 1971, name: "Inspect this checkout" },
            project: { __typename: "WorktrackerProject", id: "checkout-project", slug: "CODING" },
          }] } } as never;
        }
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout: {
                __typename: "ModuleCheckoutChangesView",
                available: true,
                reason: null,
                branch: "main",
                default_branch: "main",
                committed_count: 0,
                pull_request_creation_eligible: false,
                baseline: "origin/main",
                baseline_kind: "upstream",
                clean: true,
                dirty: false,
                unpushed_count: 0,
                truncated: false,
                files: [],
                insertions: 0,
                deletions: 0,
              },
              worktrees: [
                {
                  __typename: "CurrentWorktreeView",
                  kind: "module",
                  task_id: null,
                  task_key: null,
                  task_name: null,
                  branch: "main",
                  available: true,
                  clean: true,
                  dirty: false,
                  unpushed_count: 0,
                  pull_request_state: "none",
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
                    reason: null,
                  },
                  reason: null,
                },
                {
                  __typename: "CurrentWorktreeView",
                  kind: "task",
                  task_id: REVIEW_TASK_ID,
                  task_key: "CODING-1971",
                  task_name: "Inspect this checkout",
                  branch: "wt/CODING-1971-inspect",
                  available: true,
                  clean: true,
                  dirty: false,
                  unpushed_count: 1,
                  pull_request_state: "none",
                  pull_request: null,
                  reason: null,
                },
              ],
            },
          } as never;
        }
        if (operation === "WorktreeStatus") {
          return {
            worktree_status: {
              __typename: "WorktreeStatusView",
              kind: "worktree",
              task_id: REVIEW_TASK_ID,
              top_level_task_id: REVIEW_TASK_ID,
              is_shared: false,
              branch: "wt/CODING-1971-inspect",
              base_branch: "main",
              path: "/worktrees/CODING-1971",
              state: "active",
              clean: true,
              dirty: false,
              ahead: 1,
              behind: 0,
              conflict: false,
              checkout_present: true,
              ephemeral: false,
              reason: null,
            },
          } as never;
        }
        if (operation === "WorktreeChanges") {
          return {
            worktree_changes: {
              __typename: "WorktreeChangesView",
              task_id: REVIEW_TASK_ID,
              top_level_task_id: REVIEW_TASK_ID,
              is_shared: false,
              base_commit: "0123456789abcdef0123456789abcdef01234567",
              committed_count: 1,
              pull_request_url: null,
              pull_request_creation_eligible: false,
              work_item_done: false,
              closure_failure: null,
              cleanup: {
                __typename: "WorktreeCleanupStatusView",
                eligible: false,
                blocker: "pull_request_absent",
                reason: "No pull request is mapped to this worktree.",
              },
              pull_request: null,
              clean: true,
              dirty: false,
              unpushed_count: 1,
              truncated: false,
              files: [],
              insertions: 0,
              deletions: 0,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const moduleWorkspace = await screen.findByTestId("module-workspace-region");
    const originTabs = await within(moduleWorkspace).findByRole("tablist", {
      name: "Workspace tabs",
    });
    act(() => {
      useClientStore.setState({
        workspaces: {
          [ORIGIN_TASK_ID]: {
            active: "details",
            activeDocId: null,
            closedDocIds: [],
          },
        },
        activeByTask: { [ORIGIN_TASK_ID]: "origin-session" },
        focusedPane: "details-or-terminal",
        editViewZone: "active-tab-body",
        editViewBodyEngaged: true,
      });
    });
    expect(within(originTabs).getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const changes = screen.getByRole("button", { name: "Open module Changes" });
    changes.focus();
    fireEvent.click(changes);

    const review = await screen.findByTestId("changes-workspace");
    expect(review).toBeVisible();
    expect(within(moduleWorkspace).queryByRole("tablist", { name: "Workspace tabs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to planning workspace" })).toBeVisible();
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);
    expect(useClientStore.getState().workspaces[ORIGIN_TASK_ID]).toMatchObject({
      active: "details",
      activeDocId: null,
    });
    expect(useClientStore.getState().activeByTask[ORIGIN_TASK_ID]).toBe("origin-session");

    fireEvent.click(
      within(review).getByRole("button", {
        name: "Open CODING-1971 Inspect this checkout Changes",
      }),
    );
    expect(await screen.findByTestId("task-worktree-changes")).toBeVisible();
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);

    fireEvent.click(screen.getByRole("button", { name: "Back to planning workspace" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open module Changes" })).toHaveFocus(),
    );
    expect(screen.queryByTestId("changes-workspace")).toBeNull();
    expect(within(moduleWorkspace).getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useClientStore.getState()).toMatchObject({
      selectedModuleId: "module-1",
      selectedTaskId: ORIGIN_TASK_ID,
      activeByTask: { [ORIGIN_TASK_ID]: "origin-session" },
      panelLayout: [18, 32, 50],
      focusedPane: "details-or-terminal",
      editViewZone: "active-tab-body",
      editViewBodyEngaged: true,
    });
  });
});
