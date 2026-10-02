import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { ChangesWorkspace } from "../features/agents/worktrees";
import { FooterChangesToggle } from "../app/shell/FooterChangesToggle";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { WorktreeChangesDocument } from "../features/agents/worktrees/generated/worktreeChanges.documents";
import { fixture, mountStudio as mountStudioSeam, workItem } from "./seam";
import { openBranchInspector } from "./changesSurface";
import { TASK_ID, activeCleanWorktree, cumulativeChanges } from "./taskWorktreeChangesFixtures";

vi.mock("../app/shell/layout/useStudioPanelLayout", () => ({
  useStudioPanelLayout: () => ({
    layout: [18, 32, 50], sidebarVisible: true, outerGroupRef: { current: null },
    workAreaGroupRef: { current: null }, handleOuterLayout: () => {}, handleWorkAreaLayout: () => {},
  }),
}));

function mountStudio(options: Parameters<typeof mountStudioSeam>[0]) {
  return mountStudioSeam({
    ...options,
    children: <>{options.children}<ChangesWorkspace /><FooterChangesToggle /></>,
  });
}

describe("overhaul acceptance - stacked task pull requests", () => {
  it.each([
    { name: "[overhaul-192] preserves clean state and Open PR when the final refresh fails", rejectFirst: false },
    { name: "[overhaul-405] retries PR creation after the stack commits and pushes successfully", rejectFirst: true },
  ])("$name", async ({ rejectFirst }) => {
    const http = fixture();
    let attempts = 0;
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
          if (!rejectFirst && changes.pull_request_url) throw new Error("Status refresh unavailable.");
          return { worktree_changes: changes } as never;
        }
        if (operation === "WorktreeCommitPush") {
          changes = {
            ...changes, clean: true, dirty: false, unpushed_count: 0,
            insertions: 9, deletions: 2, files: [],
          };
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
          if (++attempts === 1 && rejectFirst) throw new Error("GitHub rejected the pull-request request.");
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
    await openBranchInspector();
    fireEvent.click(await screen.findByRole("button", { name: /^Commit, push & create PR/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    if (rejectFirst) {
      expect(await screen.findByText("GitHub rejected the pull-request request.")).toHaveAttribute("role", "alert");
      expect(screen.queryByText("Committed, pushed, and created a pull request.")).toBeNull();
      expect(screen.queryByText("Commit and push failed.")).toBeNull();
      const retry = await screen.findByRole("button", { name: "Create PR" });
      expect(retry).toBeEnabled();
      fireEvent.click(retry);
    }

    const open = await screen.findByRole("link", { name: "Open PR" });
    expect(open).toHaveAttribute(
      "href",
      "https://github.com/ticketry-hq/ticketry/pull/1324",
    );
    expect(screen.queryByRole("button", { name: "Create PR" })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /^Commit & push/ })).toBeDisabled();
    expect(studioApolloClient().readQuery({
      query: WorktreeChangesDocument,
      variables: { taskId: TASK_ID },
    })?.worktree_changes).toMatchObject({
      clean: true, dirty: false, unpushed_count: 0, insertions: 9, deletions: 2, files: [],
    });
    expect(commands.map(({ operation }) => operation)).toEqual([
      "WorktreeCommitPush",
      "WorktreeCreatePullRequest",
      ...(rejectFirst ? ["WorktreeCreatePullRequest"] : []),
    ]);
    expect(commands.every(({ variables }) => (
      variables as { taskId: string }
    ).taskId === TASK_ID)).toBe(true);
  });

});
