import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FooterChangesToggle } from "../app/shell/FooterChangesToggle";
import { StudioFooter } from "../app/shell/StudioFooter";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { scratchBucketId } from "../features/agents/terminal";
import { TEMP_TASK_ID } from "../features/agents/types";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { ModuleVersionControlDocument } from "../features/agents/worktrees/generated/moduleVersionControl.documents";
import { useClientStore } from "../state/clientStore";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "active-task-worktree";

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

  it("[overhaul-188] orders all required facts and navigates module and task rows without a write", async () => {
    const http = fixture();
    const operations: string[] = [];
    http.tree("module-1", {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    http.workItems([
      workItem({
        id: TASK_ID,
        name: "Add module checkout Changes",
        parent_id: "module-1",
        sequence_id: 1322,
      }),
    ]);

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
              checkout: moduleCheckout({
                branch: "feature/module-changes",
                baseline: "main",
                baseline_kind: "default_merge_base",
                clean: false,
                dirty: true,
                unpushed_count: 2,
                files: [{
                  __typename: "ChangedFile",
                  path: "studio/src/moduleChanges.tsx",
                  previous_path: null,
                  status: "modified",
                }],
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
              files: [],
            },
          } as never;
        }
        return http.executeGraphQl(document, variables);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Open module Changes" }));
    const list = await screen.findByRole("list", { name: "Current worktree checkouts" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName("Open Module checkout Changes");
    expect(rows[1]).toHaveAccessibleName(
      "Open CODING-1322 Add module checkout Changes Changes",
    );
    expect(within(rows[1]).getByText("Dirty")).toBeVisible();
    expect(within(rows[1]).getByText("3 unpushed")).toBeVisible();
    expect(within(rows[1]).getByText("Ready to merge")).toBeVisible();
    expect(screen.getByText("Compared from the merge base with main")).toBeVisible();

    fireEvent.click(rows[0]);
    expect(useClientStore.getState().selectedTaskId).toBe(TEMP_TASK_ID);
    fireEvent.click(rows[1]);
    await waitFor(() => expect(useClientStore.getState().selectedTaskId).toBe(TASK_ID));
    const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
    await waitFor(() =>
      expect(within(tabs).getByRole("tab", { name: "Changes" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );

    expect(operations).not.toContain("UpdateWorkItem");
    expect(operations).not.toContain("WorktreeCreate");
    expect(operations).not.toContain("WorktreeDiscard");
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
    fireEvent.change(screen.getByRole("textbox", { name: "Commit message" }), {
      target: { value: "Module work" },
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
