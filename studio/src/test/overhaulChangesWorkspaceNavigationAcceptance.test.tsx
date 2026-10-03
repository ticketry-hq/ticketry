import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { describe, expect, it, vi } from "vitest";

import { StudioFooter } from "../app/shell/StudioFooter";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { ChangesToolbar } from "../features/agents/worktrees/changes/ChangesToolbar";
import {
  useChangesActions,
  type ChangesCommands,
} from "../features/agents/worktrees/changes/useChangesActions";
import { useBranchInspector } from "../features/agents/worktrees/changes/branchInspectorState";
import { CurrentWorktreesDocument } from "../features/agents/worktrees/generated/currentWorktrees.documents";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const ORIGIN_TASK_ID = "changes-origin-task";
const REVIEW_TASK_ID = "changes-review-task";

vi.mock("../features/agents/worktrees/changes/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => <div>{patch}</div>,
}));

describe("overhaul acceptance - independent Changes workspace navigation", () => {
  it("[overhaul-332] owns keyboard review and restores the exact planning origin", async () => {
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
    const keymap = renderHook(() => useGlobalKeymap());

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
    const staleDetailsTab = within(originTabs).getByRole("tab", { name: "Details" });
    expect(staleDetailsTab).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const changes = screen.getByTestId("workspace-tab-changes");
    changes.focus();
    fireEvent.keyDown(changes, { key: "Enter" });

    const review = await screen.findByTestId("changes-workspace");
    expect(review).toBeVisible();
    const switcher = screen.getByRole("button", {
      name: "Choose checkout",
    });
    await waitFor(() => expect(switcher).toHaveFocus());
    expect(within(moduleWorkspace).queryByRole("tablist", { name: "Workspace tabs" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Module 1" })).toBeVisible();
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);
    expect(useClientStore.getState().workspaces[ORIGIN_TASK_ID]).toMatchObject({
      active: "details",
      activeDocId: null,
    });
    expect(useClientStore.getState().activeByTask[ORIGIN_TASK_ID]).toBe("origin-session");
    fireEvent.keyDown(staleDetailsTab, { key: "ArrowRight" });
    expect(screen.getByTestId("independent-changes-workspace")).toBeVisible();
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    act(() => useClientStore.setState({
      sidebarVisible: false,
      editViewZone: "stories",
    }));
    fireEvent.keyDown(switcher, { key: "Tab", shiftKey: true });
    expect(useClientStore.getState().editViewZone).toBe("stories");
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);

    act(() => useClientStore.setState({
      sidebarVisible: true,
      focusedPane: "tasks",
    }));
    fireEvent.keyDown(switcher, { key: "ArrowDown" });
    // Down enters review; Enter opens the checkout popup whose Escape stays local.
    fireEvent.keyDown(switcher, { key: "Enter" });
    const checkoutToCancel = screen.getByRole("option", { name: "Open Module checkout Changes" });
    await waitFor(() => expect(checkoutToCancel).toHaveFocus());
    fireEvent.keyDown(checkoutToCancel, { key: "Escape" });
    await waitFor(() => expect(switcher).toHaveFocus());
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);
    expect(screen.getByTestId("independent-changes-workspace")).toBeVisible();

    fireEvent.keyDown(switcher, { key: "`", ctrlKey: true });
    expect(useTerminalPanelStore.getState().openModules["module-1"]).toBe(true);
    fireEvent.keyDown(switcher, { key: "`", ctrlKey: true });
    expect(useTerminalPanelStore.getState().openModules["module-1"]).toBe(false);

    fireEvent.keyDown(switcher, { key: "e" });
    expect(useModalStore.getState().modalStack.at(-1)?.type).toBe("settings");
    fireEvent.keyDown(switcher, { key: "ArrowDown" });
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);
    act(() => useModalStore.setState({ modalStack: [] }));

    fireEvent.keyDown(switcher, { key: "Enter" });
    const moduleCheckout = screen.getByRole("option", {
      name: "Open Module checkout Changes",
    });
    await waitFor(() => expect(moduleCheckout).toHaveFocus());
    fireEvent.keyDown(moduleCheckout, { key: "End" });
    const taskCheckout = screen.getByRole("option", {
      name: "Open CODING-1971 Inspect this checkout Changes",
    });
    await waitFor(() => expect(taskCheckout).toHaveFocus());
    fireEvent.keyDown(taskCheckout, { key: "Escape" });
    await waitFor(() => expect(switcher).toHaveFocus());
    expect(screen.getByTestId("module-version-control")).toBeVisible();

    fireEvent.keyDown(switcher, { key: "Enter" });
    const reopenedModuleCheckout = screen.getByRole("option", {
      name: "Open Module checkout Changes",
    });
    const reopenedTaskCheckout = screen.getByRole("option", {
      name: "Open CODING-1971 Inspect this checkout Changes",
    });
    await waitFor(() => expect(reopenedModuleCheckout).toHaveFocus());
    fireEvent.keyDown(reopenedModuleCheckout, { key: "End" });
    await waitFor(() => expect(reopenedTaskCheckout).toHaveFocus());
    fireEvent.keyDown(reopenedTaskCheckout, { key: " " });
    expect(await screen.findByTestId("task-worktree-changes")).toBeVisible();
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Choose checkout" }),
    ).toHaveFocus());
    expect(useClientStore.getState().selectedTaskId).toBe(ORIGIN_TASK_ID);

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-tab-changes")).toHaveFocus(),
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

    act(() => useClientStore.setState({ sidebarVisible: false }));
    const hiddenSidebarEntry = screen.getByTestId("workspace-tab-changes");
    hiddenSidebarEntry.focus();
    fireEvent.keyDown(hiddenSidebarEntry, { key: " " });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Choose checkout" })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Module 1" }));
    keymap.unmount();
  });

  it("[overhaul-355] returns Branch focus to the visible Changes workspace when planning remains mounted", async () => {
    const http = fixture();
    http.tree("module-1", {
      rootIds: [ORIGIN_TASK_ID],
      children: { [ORIGIN_TASK_ID]: [] },
      order: [ORIGIN_TASK_ID],
    });
    http.workItems([
      workItem({
        id: ORIGIN_TASK_ID,
        name: "Keep both Changes surfaces mounted",
        parent_id: "module-1",
        sequence_id: 1970,
      }),
    ]);
    useBranchInspector.setState({ open: false, sections: {} });

    mountStudio({
      http,
      selectedTaskId: ORIGIN_TASK_ID,
      children: (
        <TicketWorkspace
          tasksSize={40}
          workspaceSize={60}
          groupRef={createRef<ImperativePanelGroupHandle>()}
          onLayout={() => {}}
        />
      ),
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "CurrentWorktrees") {
          return { worktrees: { __typename: "WorktreesConnection", nodes: [] } } as never;
        }
        if (operation === "WorktreeStatus") {
          return {
            worktree_status: {
              __typename: "WorktreeStatusView",
              kind: "worktree",
              task_id: ORIGIN_TASK_ID,
              top_level_task_id: ORIGIN_TASK_ID,
              is_shared: false,
              branch: "wt/CODING-1970-focus",
              base_branch: "main",
              path: "/worktrees/CODING-1970",
              state: "active",
              clean: true,
              dirty: false,
              ahead: 0,
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
              task_id: ORIGIN_TASK_ID,
              top_level_task_id: ORIGIN_TASK_ID,
              is_shared: false,
              base_commit: "0123456789abcdef0123456789abcdef01234567",
              committed_count: 1,
              pull_request_url: null,
              pull_request_creation_eligible: false,
              work_item_done: false,
              closure_failure: null,
              cleanup: null,
              pull_request: {
                __typename: "PullRequestStatusView",
                url: null,
                state: "none",
                target_branch: "wt/CODING-1970-focus",
                head_commit: null,
                integrated: false,
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
              insertions: 0,
              deletions: 0,
            },
          } as never;
        }
        if (operation === "WorktreeMergePreview") {
          return { worktree_merge_preview: null } as never;
        }
        if (operation === "WorktreeMergeRecovery") {
          return { worktree_merge_recovery: null } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    act(() => {
      useClientStore.getState().setActive(ORIGIN_TASK_ID, "changes");
    });
    const planning = await screen.findByTestId("workspace-changes-surface");
    expect(within(planning).getByTestId("task-worktree-changes")).toBeVisible();

    fireEvent.click(within(screen.getByTestId("module-workspace-region")).getByRole("tab", {
      name: "Changes",
    }));
    const visibleWorkspace = await screen.findByTestId("independent-changes-workspace");
    const visibleBranch = within(visibleWorkspace).getByRole("button", { name: "Branch" });
    fireEvent.click(visibleBranch);
    const visibleInspector = await within(visibleWorkspace).findByRole("complementary", {
      name: "Branch inspector",
    });
    await waitFor(() => expect(within(visibleInspector).getByRole("button", {
      name: "Close branch inspector",
    })).toHaveFocus());

    fireEvent.click(within(visibleInspector).getByRole("button", {
      name: "Close branch inspector",
    }));

    await waitFor(() => expect(visibleBranch).toHaveFocus());
  });

  it("[overhaul-341] clamps checkout keys and recovers focus by checkout identity", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    const onOpenModule = vi.fn();
    const onOpenTask = vi.fn();
    const commands: ChangesCommands = {
      branch: "wt/task-a",
      dirty: false,
      unpushedCount: 0,
      onCommit: async () => undefined,
      onPush: async () => undefined,
    };
    const initialRows = [
      {
        __typename: "Worktrees",
        id: "worktree-a",
        taskId: "task-a",
        branch: "wt/task-a",
        issue: { __typename: "WorktrackerIssue", id: "task-a", sequenceId: 201, name: "Task A" },
        project: { __typename: "WorktrackerProject", id: "project-1", slug: "CODING" },
      },
      {
        __typename: "Worktrees",
        id: "worktree-b",
        taskId: "task-b",
        branch: "wt/task-b",
        issue: { __typename: "WorktrackerIssue", id: "task-b", sequenceId: 202, name: "Task B" },
        project: { __typename: "WorktrackerProject", id: "project-1", slug: "CODING" },
      },
    ];
    let rows = initialRows;

    function Harness() {
      const actions = useChangesActions(commands);
      return (
        <>
          <ChangesToolbar
            actions={actions}
            moduleId="module-1"
            selectedTaskId="task-a"
            onOpenModule={onOpenModule}
            onOpenTask={onOpenTask}
          />
          <button type="button">After Changes toolbar</button>
        </>
      );
    }

    mountStudio({
      http,
      children: <Harness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "CurrentWorktrees") {
          expect(variables).toEqual({ moduleId: "module-1" });
          return {
            worktrees: { __typename: "WorktreesConnection", nodes: rows },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });
    const keymap = renderHook(() => useGlobalKeymap());
    const trigger = screen.getByRole("button", { name: "Choose checkout" });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.keyDown(trigger, { key: "Enter" });
    const moduleRow = await screen.findByRole("option", {
      name: "Open Module checkout Changes",
    });
    const taskA = screen.getByRole("option", { name: /Open \S+-201 Task A Changes/ });
    const taskB = screen.getByRole("option", { name: /Open \S+-202 Task B Changes/ });
    await waitFor(() => expect(taskA).toHaveFocus());

    fireEvent.keyDown(taskA, { key: "ArrowUp" });
    await waitFor(() => expect(moduleRow).toHaveFocus());
    fireEvent.keyDown(moduleRow, { key: "ArrowUp" });
    await waitFor(() => expect(moduleRow).toHaveFocus());
    fireEvent.keyDown(moduleRow, { key: "End" });
    await waitFor(() => expect(taskB).toHaveFocus());
    fireEvent.keyDown(taskB, { key: "ArrowDown" });
    await waitFor(() => expect(taskB).toHaveFocus());
    fireEvent.keyDown(taskB, { key: "Home" });
    await waitFor(() => expect(moduleRow).toHaveFocus());
    fireEvent.keyDown(moduleRow, { key: "ArrowDown" });
    await waitFor(() => expect(taskA).toHaveFocus());

    rows = initialRows.map((row) => row.taskId === "task-a"
      ? { ...row, issue: { ...row.issue, name: "Task A refreshed" } }
      : row);
    await act(async () => {
      await studioApolloClient().refetchQueries({ include: [CurrentWorktreesDocument] });
    });
    const refreshedTaskA = screen.getByRole("option", {
      name: /Open \S+-201 Task A refreshed Changes/,
    });
    expect(refreshedTaskA).toHaveFocus();

    rows = initialRows.filter((row) => row.taskId !== "task-a");
    await act(async () => {
      await studioApolloClient().refetchQueries({ include: [CurrentWorktreesDocument] });
    });
    const fallbackModuleRow = screen.getByRole("option", {
      name: "Open Module checkout Changes",
    });
    await waitFor(() => expect(fallbackModuleRow).toHaveFocus());

    fireEvent.keyDown(fallbackModuleRow, { key: "Enter" });
    expect(onOpenModule).toHaveBeenCalledTimes(1);
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    fireEvent.keyDown(trigger, { key: " " });
    const reopenedModuleRow = screen.getByRole("option", {
      name: "Open Module checkout Changes",
    });
    const reopenedTaskB = screen.getByRole("option", { name: /Open \S+-202 Task B Changes/ });
    await waitFor(() => expect(reopenedModuleRow).toHaveFocus());
    fireEvent.keyDown(reopenedModuleRow, { key: "End" });
    await waitFor(() => expect(reopenedTaskB).toHaveFocus());
    fireEvent.keyDown(reopenedTaskB, { key: " " });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask).toHaveBeenLastCalledWith("task-b");

    fireEvent.keyDown(trigger, { key: "Enter" });
    const cancelModuleRow = screen.getByRole("option", {
      name: "Open Module checkout Changes",
    });
    await waitFor(() => expect(cancelModuleRow).toHaveFocus());
    fireEvent.keyDown(cancelModuleRow, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("option", {
      name: "Open Module checkout Changes",
    })).toHaveFocus());
    const departure = screen.getByRole("button", { name: "After Changes toolbar" });
    departure.focus();
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    rows = initialRows;
    await act(async () => {
      await studioApolloClient().refetchQueries({ include: [CurrentWorktreesDocument] });
    });
    expect(departure).toHaveFocus();
    keymap.unmount();
  });
});
