import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { describe, expect, it, vi } from "vitest";

import { FooterChangesToggle } from "../app/shell/FooterChangesToggle";
import { StudioFooter } from "../app/shell/StudioFooter";
import { TicketWorkspace } from "../app/shell/ticket-workspace/TicketWorkspace";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { scratchBucketId } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { ModuleVersionControlDocument } from "../features/agents/worktrees/generated/moduleVersionControl.documents";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "active-task-worktree";
const PLANNING_TASK_ID = "planning-task";

vi.mock("../features/agents/worktrees/changes/PatchViewer", () => ({
  default: ({ patch }: { patch: string }) => <div data-testid="patch-viewer">{patch}</div>,
}));

function moduleCheckout(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function moduleRow(overrides: Record<string, unknown> = {}) {
  return {
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
    pull_request: pullRequest(),
    reason: null,
    ...overrides,
  };
}

function ModuleWorkspaceHarness() {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const bucket = selectedTaskId === TEMP_TASK_ID
    ? scratchBucketId(moduleId ?? "")
    : selectedTaskId;
  return (
    <>
      <FooterChangesToggle />
      <SelectedTicketContent
        bucket={bucket}
        projectId="project-1"
        moduleId={moduleId}
        owner="studio"
        details={<div>Workspace details</div>}
      />
    </>
  );
}

function FullWindowWorkspaceHarness() {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const bucket = selectedTaskId === TEMP_TASK_ID
    ? scratchBucketId(moduleId ?? "")
    : selectedTaskId;
  const changesActive = useClientStore(
    (state) => Boolean(bucket && state.workspaces[bucket]?.active === "changes"),
  );
  return (
    <>
      <TicketWorkspace
        tasksSize={40}
        workspaceSize={60}
        groupRef={createRef<ImperativePanelGroupHandle>()}
        onLayout={() => {}}
        changesActive={changesActive}
      />
      <StudioFooter />
    </>
  );
}

describe("overhaul acceptance - module Changes and current worktrees", () => {
  it("[overhaul-239] puts module Changes in the footer's left slot with a version-control symbol", () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    mountStudio({ http, children: <StudioFooter /> });

    const changes = screen.getByRole("button", { name: "Open module Changes" });
    const footer = changes.parentElement?.parentElement;
    expect(footer).not.toBeNull();
    expect(footer?.firstElementChild).toContainElement(changes);
    expect(footer?.lastElementChild).not.toContainElement(changes);
    expect(footer?.lastElementChild).toContainElement(
      screen.getByRole("button", { name: "Open terminal panel" }),
    );
    expect(footer?.lastElementChild).toContainElement(
      screen.getByRole("button", { name: "Open Settings" }),
    );
    expect(footer?.children[1]).toHaveClass("justify-center");
    expect(within(changes).getByTestId("version-control-icon")).toBeVisible();

    act(() => useClientStore.setState({ selectedModuleId: null }));

    expect(changes).toBeDisabled();
    expect(changes).toHaveAccessibleName("Select a module to open Changes");
    expect(changes).toHaveAttribute("title", "Select a module to open Changes");
  });

  it("[overhaul-187] opens clean module Changes and presents the empty task list", async () => {
    const http = fixture();
    const operations: string[] = [];
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        operations.push(operation);
        if (operation === "ModuleVersionControl") {
          expect(variables).toEqual({ moduleId: "module-1" });
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout: moduleCheckout(),
              worktrees: [moduleRow()],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const control = screen.getByRole("button", { name: "Open module Changes" });
    fireEvent.click(control);

    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    expect(within(tabs).getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("module-version-control")).toBeVisible();
    expect(screen.getByText("Clean")).toBeVisible();
    expect(screen.getAllByText("0 unpushed").length).toBeGreaterThan(0);
    expect(screen.getByText("No module changes from the selected baseline.")).toBeVisible();
    expect(screen.getByText("No current task worktrees.")).toBeVisible();
    expect(operations).toContain("ModuleVersionControl");
  });

  it("[overhaul-188] uses one full-window, resizable Changes workspace for module and task checkouts", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const http = fixture();
    const operations: string[] = [];
    const worktreeChangesTaskIds: string[] = [];
    const modulePath = "studio/src/moduleChanges.tsx";
    const taskPath = "studio/src/taskChanges.tsx";
    http.tree("module-1", {
      rootIds: [PLANNING_TASK_ID, TASK_ID],
      children: { [PLANNING_TASK_ID]: [], [TASK_ID]: [] },
      order: [PLANNING_TASK_ID, TASK_ID],
    });
    http.workItems([
      workItem({
        id: PLANNING_TASK_ID,
        name: "Planning context",
        parent_id: "module-1",
        sequence_id: 1321,
      }),
      workItem({
        id: TASK_ID,
        name: "Add module checkout Changes",
        parent_id: "module-1",
        sequence_id: 1322,
      }),
    ]);

    mountStudio({
      http,
      selectedTaskId: PLANNING_TASK_ID,
      children: <FullWindowWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        operations.push(operation);
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout: moduleCheckout({
                branch: "feature/module-changes",
                baseline: "main",
                baseline_kind: "default_merge_base",
                clean: false,
                dirty: true,
                unpushed_count: 2,
                files: [{
                  __typename: "ChangedFile",
                  path: modulePath,
                  previous_path: null,
                  status: "modified",
                  binary: false,
                  insertions: 2,
                  deletions: 1,
                }],
                insertions: 2,
                deletions: 1,
              }),
              worktrees: [
                moduleRow({
                  branch: "feature/module-changes",
                  clean: false,
                  dirty: true,
                  unpushed_count: 2,
                }),
                {
                  __typename: "CurrentWorktreeView",
                  kind: "task",
                  task_id: TASK_ID,
                  task_key: "CODING-1322",
                  task_name: "Add module checkout Changes",
                  branch: "wt/CODING-1322-module-changes",
                  available: true,
                  clean: false,
                  dirty: true,
                  unpushed_count: 3,
                  pull_request_state: "ready",
                  pull_request: pullRequest({
                    url: "https://github.com/ticketry-hq/ticketry/pull/1324",
                    state: "ready",
                    target_branch: "main",
                    head_commit: "0000000000000000000000000000000000000000",
                  }),
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
              task_id: TASK_ID,
              top_level_task_id: TASK_ID,
              is_shared: false,
              branch: "wt/CODING-1322-module-changes",
              base_branch: "main",
              path: "/worktrees/CODING-1322",
              state: "active",
              clean: false,
              dirty: true,
              ahead: 3,
              behind: 0,
              conflict: false,
              checkout_present: true,
              ephemeral: false,
              reason: null,
            },
          } as never;
        }
        if (operation === "WorktreeChanges") {
          worktreeChangesTaskIds.push((variables as { taskId: string }).taskId);
          return {
            worktree_changes: {
              __typename: "WorktreeChangesView",
              task_id: TASK_ID,
              top_level_task_id: TASK_ID,
              is_shared: false,
              base_commit: "0123456789abcdef0123456789abcdef01234567",
              committed_count: 3,
              pull_request_url: null,
              pull_request_creation_eligible: true,
              pull_request: pullRequest(),
              clean: false,
              dirty: true,
              unpushed_count: 3,
              truncated: false,
              work_item_done: false,
              closure_failure: null,
              cleanup: {
                __typename: "WorktreeCleanupStatusView",
                eligible: false,
                blocker: "pull_request_absent",
                reason: "No pull request is mapped to this worktree.",
              },
              files: [{
                __typename: "ChangedFile",
                path: taskPath,
                previous_path: null,
                status: "added",
                binary: false,
                insertions: 4,
                deletions: 0,
              }],
              insertions: 4,
              deletions: 0,
            },
          } as never;
        }
        if (operation === "ModuleFileDiff") {
          expect(variables).toEqual({ moduleId: "module-1", path: modulePath });
          return {
            module_file_diff: {
              __typename: "FileDiffView",
              path: modulePath,
              status: "modified",
              binary: false,
              patch: "+module workspace",
              truncated: false,
            },
          } as never;
        }
        if (operation === "WorktreeFileDiff") {
          expect(variables).toEqual({ taskId: TASK_ID, path: taskPath });
          return {
            worktree_file_diff: {
              __typename: "FileDiffView",
              path: taskPath,
              status: "added",
              binary: false,
              patch: "+task workspace",
              truncated: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    const moduleWorkspace = await screen.findByTestId("module-workspace-region");
    expect(moduleWorkspace.querySelector('[data-pane="tasks"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    expect(useClientStore.getState().selectedTaskId).toBe(PLANNING_TASK_ID);
    const workspace = await within(moduleWorkspace).findByTestId("changes-workspace");
    expect(moduleWorkspace.querySelector('[data-pane="tasks"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Open terminal panel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeVisible();

    const checkouts = within(workspace).getByRole("region", { name: "Worktree checkouts" });
    const files = within(workspace).getByRole("region", { name: "Changed files" });
    const diff = within(workspace).getByRole("region", { name: "Selected file diff" });
    expect(checkouts).toBeVisible();
    expect(files).toBeVisible();
    expect(diff).toBeVisible();

    const list = within(checkouts).getByRole("list", { name: "Current worktree checkouts" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName("Open Module checkout Changes");
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    expect(rows[1]).toHaveAccessibleName(
      "Open CODING-1322 Add module checkout Changes Changes",
    );
    expect(within(rows[1]).getByText("Dirty")).toBeVisible();
    expect(within(rows[1]).getByText("3 unpushed")).toBeVisible();
    expect(within(rows[1]).getByText("Ready to merge")).toBeVisible();
    expect(screen.getByText("Compared from the merge base with main")).toBeVisible();

    fireEvent.click(within(files).getByRole("button", { name: modulePath }));
    expect(await within(diff).findByTestId("patch-viewer")).toHaveTextContent(
      "+module workspace",
    );

    const firstHandle = within(workspace).getByRole("separator", {
      name: "Resize checkouts and changed files",
    });
    const secondHandle = within(workspace).getByRole("separator", {
      name: "Resize changed files and diff",
    });
    for (const [handle, key] of [[firstHandle, "ArrowRight"], [secondHandle, "ArrowLeft"]] as const) {
      const before = handle.getAttribute("aria-valuenow");
      fireEvent.keyDown(handle, { key });
      await waitFor(() => expect(handle).not.toHaveAttribute("aria-valuenow", before));
    }
    expect(within(moduleWorkspace).getByTestId("changes-workspace-scroll")).toHaveClass("overflow-x-auto");
    expect(workspace).toHaveClass("min-w-[56rem]");

    fireEvent.click(rows[1]);
    expect(useClientStore.getState().selectedTaskId).toBe(PLANNING_TASK_ID);
    expect(await within(moduleWorkspace).findByTestId("changes-workspace")).toBeVisible();
    const taskFiles = within(moduleWorkspace).getByRole("region", { name: "Changed files" });
    fireEvent.click(within(taskFiles).getByRole("button", { name: taskPath }));
    expect(
      await within(within(moduleWorkspace).getByRole("region", { name: "Selected file diff" })).findByTestId("patch-viewer"),
    ).toHaveTextContent("+task workspace");

    const tabs = within(moduleWorkspace).getByRole("tablist", { name: "Workspace tabs" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(within(moduleWorkspace).queryByTestId("changes-workspace")).toBeNull());
    expect(useClientStore.getState().selectedTaskId).toBe(PLANNING_TASK_ID);
    expect(moduleWorkspace.querySelector('[data-pane="tasks"]')).not.toBeNull();
    expect(
      within(moduleWorkspace).getByRole("tab", { name: "Details" }),
    ).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
    await waitFor(() => expect(worktreeChangesTaskIds).toContain(PLANNING_TASK_ID));
    expect(useClientStore.getState().selectedTaskId).toBe(PLANNING_TASK_ID);

    expect(operations).not.toContain("UpdateWorkItem");
    expect(operations).not.toContain("WorktreeCreate");
    expect(operations).not.toContain("WorktreeDiscard");
  });

  it("[overhaul-285] keeps long truncated patches readable below the file list", async () => {
    const http = fixture();
    const path = "studio/src/features/agents/worktrees/changes/ChangesFileReview.tsx";
    const patch = "diff --git a/review.tsx b/review.tsx\n+const line = \"a long patch line that must stay intact and scroll horizontally instead of wrapping into fragments\";";
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout: moduleCheckout({
                clean: false,
                dirty: true,
                files: [{
                  __typename: "ChangedFile",
                  path,
                  previous_path: null,
                  status: "modified",
                  binary: false,
                  insertions: 1,
                  deletions: 0,
                }],
                insertions: 1,
              }),
              worktrees: [moduleRow()],
            },
          } as never;
        }
        if (operation === "ModuleFileDiff") {
          expect(variables).toEqual({ moduleId: "module-1", path });
          return {
            module_file_diff: {
              __typename: "FileDiffView",
              path,
              status: "modified",
              binary: false,
              patch,
              truncated: true,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    fireEvent.click(await screen.findByRole("button", { name: path }));

    const diff = screen.getByRole("region", { name: "Selected file diff" });
    await waitFor(() =>
      expect(within(diff).getByRole("status")).toHaveTextContent("This diff is truncated."),
    );
    expect((await within(diff).findByTestId("patch-viewer")).textContent).toBe(patch);
    expect(screen.getByTestId("changes-workspace-scroll")).toHaveClass("overflow-x-auto");
    expect(screen.getByTestId("changes-diff-column")).toHaveClass("overflow-hidden");
  });

  it("[overhaul-189] distinguishes an unavailable module checkout", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    const reason = "The local folder linked to this module is not available.";
    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout: moduleCheckout({
                available: false,
                reason,
                branch: null,
                baseline: null,
                baseline_kind: null,
                clean: null,
                dirty: null,
                unpushed_count: null,
              }),
              worktrees: [moduleRow({
                available: false,
                reason,
                branch: null,
                clean: null,
                dirty: null,
                unpushed_count: null,
              })],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    expect((await screen.findAllByText("Unavailable")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
    expect(screen.getByText("Comparison unavailable")).toBeVisible();
  });

  it("[overhaul-191] offers module Push for a clean ahead branch and Commit only for dirty work", async () => {
    const http = fixture();
    const commands: string[] = [];
    let checkout = moduleCheckout({ unpushed_count: 2 });
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout,
              worktrees: [moduleRow(checkout)],
            },
          } as never;
        }
        if (operation === "ModuleCheckoutPush") {
          commands.push(operation);
          checkout = moduleCheckout({ unpushed_count: 0 });
          return {
            module_checkout_push: {
              operation_id: (variables as { operationId: string }).operationId,
              head_commit: "pushed-head",
              dirty: false,
              unpushed_count: 0,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        if (operation === "ModuleCheckoutCommit") {
          commands.push(operation);
          checkout = moduleCheckout({ unpushed_count: 1 });
          return {
            module_checkout_commit: {
              operation_id: (variables as { operationId: string }).operationId,
              subject: "Module work",
              message_source: "codex",
              head_commit: "committed-head",
              dirty: false,
              unpushed_count: 1,
              uncommitted_work_excluded: false,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    const commit = await screen.findByRole("button", { name: "Commit" });
    const push = screen.getByRole("button", { name: "Push" });
    expect(commit).toBeDisabled();
    expect(push).toBeEnabled();
    fireEvent.click(push);
    await waitFor(() => expect(push).toBeDisabled());

    checkout = moduleCheckout({ clean: false, dirty: true, unpushed_count: 0 });
    await act(async () => {
      await studioApolloClient().refetchQueries({ include: [ModuleVersionControlDocument] });
    });
    expect(commit).toBeEnabled();
    expect(push).toBeDisabled();
    fireEvent.click(commit);
    await waitFor(() => expect(commit).toBeDisabled());
    expect(push).toBeEnabled();
    expect(commands).toEqual(["ModuleCheckoutPush", "ModuleCheckoutCommit"]);
  });

  it("[overhaul-195] creates a module-checkout pull request against the default branch without changing a Work Item", async () => {
    const http = fixture();
    const operations: string[] = [];
    let checkout = moduleCheckout({
      branch: "feature/module-pr",
      default_branch: "main",
      committed_count: 2,
      pull_request_creation_eligible: true,
      clean: false,
      dirty: true,
      unpushed_count: 2,
    });
    http.tree("module-1", { rootIds: [], children: {}, order: [] });

    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        const operation = documentOperationName(document);
        operations.push(operation);
        if (operation === "ModuleVersionControl") {
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout,
              worktrees: [moduleRow(checkout)],
            },
          } as never;
        }
        if (operation === "ModuleCheckoutCreatePullRequest") {
          checkout = moduleCheckout({
            branch: "feature/module-pr",
            default_branch: "main",
            committed_count: 2,
            pull_request_creation_eligible: true,
            clean: false,
            dirty: true,
            unpushed_count: 0,
          });
          return {
            module_checkout_pull_request_create: {
              operation_id: (variables as { operationId: string }).operationId,
              url: "https://github.com/ticketry-hq/ticketry/pull/1325",
              title: "Merge 2 commits from feature/module-pr",
              body: "Merging `feature/module-pr` into `main`.",
              message_source: "claude",
              branch: "feature/module-pr",
              base_branch: "main",
              pushed: true,
              uncommitted_work_excluded: true,
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    expect(await screen.findByRole("button", { name: "Create PR" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Create PR follows the same rule.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
    expect(await screen.findByRole("link", { name: "Open PR" })).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/1325",
    );
    expect(operations).toContain("ModuleCheckoutCreatePullRequest");
    expect(operations).not.toContain("UpdateWorkItem");
    expect(operations).not.toContain("WorktreeDiscard");
  });

  it("[overhaul-196] has no pull-request action for the module default branch", async () => {
    const http = fixture();
    http.tree("module-1", { rootIds: [], children: {}, order: [] });
    mountStudio({
      http,
      children: <ModuleWorkspaceHarness />,
      graphQlExecute: async (document, variables) => {
        if (documentOperationName(document) === "ModuleVersionControl") {
          const checkout = moduleCheckout({
            branch: "main",
            default_branch: "main",
            committed_count: 1,
            pull_request_creation_eligible: false,
          });
          return {
            module_version_control: {
              __typename: "ModuleVersionControlView",
              module_id: "module-1",
              worktrees_truncated: false,
              checkout,
              worktrees: [moduleRow(checkout)],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    await screen.findByTestId("module-version-control");
    expect(screen.queryByRole("button", { name: "Create PR" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open PR" })).toBeNull();
  });
});
