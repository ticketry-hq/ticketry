import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio, workItem } from "./seam";

const TASK_ID = "merge-recovery-task";
const SOURCE_COMMIT = "1111111111111111111111111111111111111111";
const DESTINATION_COMMIT = "2222222222222222222222222222222222222222";

type Recovery = {
  __typename: "WorktreeMergeResult";
  operation_id: string;
  outcome: string;
  source_branch: string;
  source_commit: string;
  destination_branch: string;
  destination_commit: string;
  destination_checkout: string;
  unmerged_paths: Array<{ __typename: "WorktreeMergePath"; path: string }>;
  blocker: string | null;
  reason: string | null;
};

const recovery = (overrides: Partial<Recovery> = {}): Recovery => ({
  __typename: "WorktreeMergeResult",
  operation_id: "merge-operation",
  outcome: "conflicted",
  source_branch: "wt/CODING-1894-divergent",
  source_commit: SOURCE_COMMIT,
  destination_branch: "main",
  destination_commit: DESTINATION_COMMIT,
  destination_checkout: "/repos/ticketry",
  unmerged_paths: ["src/app.ts", "src/routes.ts"].map((path) => ({
    __typename: "WorktreeMergePath" as const,
    path,
  })),
  blocker: null,
  reason: "Resolve and stage the listed files, then finish or abort this merge.",
  ...overrides,
});

const preview = () => ({
  __typename: "WorktreeMergePreviewView",
  source_branch: "wt/CODING-1894-divergent",
  source_commit: SOURCE_COMMIT,
  destination_branch: "main",
  destination_commit: DESTINATION_COMMIT,
  destination_checkout: "/repos/ticketry",
  destination_checkout_identity: "main-checkout",
  confirmation_token: "merge-confirmation",
  ready: true,
  blocker: null,
  reason: null,
  requires_destination_selection: false,
  destinations: [],
});

const changes = {
  __typename: "WorktreeChangesView",
  task_id: TASK_ID,
  top_level_task_id: TASK_ID,
  is_shared: false,
  base_commit: DESTINATION_COMMIT,
  committed_count: 1,
  pull_request_url: null,
  pull_request_creation_eligible: false,
  work_item_done: false,
  closure_failure: null,
  cleanup: { __typename: "WorktreeCleanupStatusView", eligible: false, blocker: "pull_request_absent", reason: null },
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
  clean: true,
  dirty: false,
  unpushed_count: 1,
  truncated: false,
  files: [],
  insertions: 0,
  deletions: 0,
};

function mountMergeRecovery(
  execute: (operation: string, variables: unknown) => Promise<unknown>,
) {
  const http = fixture();
  http.tree("module-1", {
    rootIds: [TASK_ID],
    children: { [TASK_ID]: [] },
    order: [TASK_ID],
  });
  http.workItems([workItem({ id: TASK_ID, parent_id: "module-1", sequence_id: 1894 })]);

  return mountStudio({
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
      const result = await execute(operation, variables);
      if (result !== undefined) return result as never;
      if (operation === "WorktreeStatus") {
        return {
          worktree_status: {
            __typename: "WorktreeStatusView",
            kind: "worktree",
            task_id: TASK_ID,
            top_level_task_id: TASK_ID,
            is_shared: false,
            branch: "wt/CODING-1894-divergent",
            base_branch: "main",
            path: "/worktrees/CODING-1894-divergent",
            state: "active",
            clean: true,
            dirty: false,
            ahead: 1,
            behind: 1,
            conflict: false,
            checkout_present: true,
            ephemeral: false,
            reason: null,
          },
        } as never;
      }
      if (operation === "WorktreeChanges") return { worktree_changes: changes } as never;
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
              baseline: DESTINATION_COMMIT,
              baseline_kind: "head",
              clean: true,
              dirty: false,
              unpushed_count: 0,
              truncated: false,
              files: [],
              insertions: 0,
              deletions: 0,
            },
            worktrees: [],
          },
        } as never;
      }
      return http.executeGraphQl(document, variables);
    },
  });
}

async function openChanges() {
  const tabs = await screen.findByRole("tablist", { name: "Workspace tabs" });
  fireEvent.click(within(tabs).getByRole("tab", { name: "Changes" }));
}

describe("overhaul acceptance - divergent local merge recovery", () => {
  it("[overhaul-316] reports a completed divergent merge and converges affected Changes reads", async () => {
    const reads: string[] = [];
    let merged = false;
    mountMergeRecovery(async (operation, variables) => {
      if (["WorktreeStatus", "WorktreeChanges", "ModuleVersionControl", "WorktreeMergePreview", "WorktreeMergeRecovery"].includes(operation)) {
        reads.push(operation);
      }
      if (operation === "WorktreeMergePreview") {
        return { worktree_merge_preview: preview() };
      }
      if (operation === "WorktreeMergeRecovery") {
        return { worktree_merge_recovery: null };
      }
      if (operation === "WorktreeMerge") {
        merged = true;
        return {
          worktree_merge: {
            ...recovery({ outcome: "merged", unmerged_paths: [] }),
            operation_id: (variables as { operationId: string }).operationId,
            destination_commit: "3333333333333333333333333333333333333333",
          },
        };
      }
    });

    await openChanges();
    fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }));

    expect(await screen.findByText("Merged wt/CODING-1894-divergent into main.")).toBeVisible();
    expect(merged).toBe(true);
    await waitFor(() => {
      for (const operation of ["WorktreeStatus", "WorktreeChanges", "WorktreeMergePreview", "WorktreeMergeRecovery"]) {
        expect(reads.filter((read) => read === operation).length).toBeGreaterThan(1);
      }
    });
  });

  it("[overhaul-317] keeps a destination conflict recoverable after source work continues and the view reopens", async () => {
    let pending: Recovery | null = null;
    const view = mountMergeRecovery(async (operation) => {
      if (operation === "WorktreeMergePreview") {
        return { worktree_merge_preview: preview() };
      }
      if (operation === "WorktreeMergeRecovery") {
        return { worktree_merge_recovery: pending };
      }
      if (operation === "WorktreeMerge") {
        pending = recovery();
        return { worktree_merge: pending };
      }
    });

    await openChanges();
    fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }));

    const conflict = await screen.findByRole("region", { name: "Merge conflict recovery" });
    expect(conflict).toHaveTextContent("/repos/ticketry");
    expect(within(conflict).getByRole("list", { name: "Unmerged files" })).toHaveTextContent("src/app.ts");
    expect(within(conflict).getByRole("list", { name: "Unmerged files" })).toHaveTextContent("src/routes.ts");
    expect(screen.queryByText(/Merged .* into main/)).not.toBeInTheDocument();

    view.unmount();
    mountMergeRecovery(async (operation) => {
      if (operation === "WorktreeMergePreview") return {
        worktree_merge_preview: {
          ...preview(),
          ready: false,
          blocker: "source_dirty",
          reason: "Commit or discard the task worktree's uncommitted changes, then retry.",
        },
      };
      if (operation === "WorktreeMergeRecovery") return { worktree_merge_recovery: pending };
    });
    await openChanges();
    expect(await screen.findByRole("region", { name: "Merge conflict recovery" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Abort merge" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Merge into main" })).not.toBeInTheDocument();
  });

  it("[overhaul-318] finishes only the staged resolution after confirmation and remains retryable after hook failure", async () => {
    let pending: Recovery | null = recovery({ unmerged_paths: [] });
    const writes: Array<{ operation: string; variables: unknown }> = [];
    let fail = true;
    mountMergeRecovery(async (operation, variables) => {
      if (operation === "WorktreeMergePreview") {
        return { worktree_merge_preview: preview() };
      }
      if (operation === "WorktreeMergeRecovery") {
        return { worktree_merge_recovery: pending };
      }
      if (operation === "WorktreeMergeFinish") {
        writes.push({ operation, variables });
        if (fail) throw new FoundationGraphQlError("unknown", "The commit hook rejected the resolution.");
        pending = null;
        return { worktree_merge_finish: recovery({ outcome: "merged", unmerged_paths: [] }) };
      }
    });

    await openChanges();
    fireEvent.click(await screen.findByRole("button", { name: "Finish merge" }));
    const confirmation = screen.getByRole("group", { name: "Confirm finish merge" });
    expect(confirmation).toHaveTextContent("only the staged resolution");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Confirm finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The commit hook rejected the resolution.");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Finish merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm finish" }));
    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes.every(({ operation }) => operation === "WorktreeMergeFinish")).toBe(true);
    expect(writes[1]?.variables).toEqual({
      taskId: TASK_ID,
      operationId: "merge-operation",
    });
  });

  it("[overhaul-319] aborts only the matching merge and preserves recovery controls after refusal", async () => {
    let pending: Recovery | null = recovery();
    const aborts: unknown[] = [];
    let fail = true;
    mountMergeRecovery(async (operation, variables) => {
      if (operation === "WorktreeMergePreview") {
        return { worktree_merge_preview: preview() };
      }
      if (operation === "WorktreeMergeRecovery") {
        return { worktree_merge_recovery: pending };
      }
      if (operation === "WorktreeMergeAbort") {
        aborts.push(variables);
        if (fail) throw new FoundationGraphQlError("unknown", "Git could not abort without overwriting edits.");
        pending = null;
        return { worktree_merge_abort: recovery({ outcome: "aborted", unmerged_paths: [] }) };
      }
    });

    await openChanges();
    fireEvent.click(await screen.findByRole("button", { name: "Abort merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm abort" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Git could not abort without overwriting edits.");
    expect(screen.getByRole("button", { name: "Abort merge" })).toBeEnabled();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Abort merge" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm abort" }));
    expect(await screen.findByRole("button", { name: "Merge into main" })).toBeVisible();
    expect(aborts.at(-1)).toEqual({
      taskId: TASK_ID,
      operationId: "merge-operation",
    });
  });

  it("[overhaul-320] reports externally finished and aborted merges truthfully after restart", async () => {
    let pending = recovery({ outcome: "merged", unmerged_paths: [] });
    const view = mountMergeRecovery(async (operation) => {
      if (operation === "WorktreeMergePreview") return { worktree_merge_preview: preview() };
      if (operation === "WorktreeMergeRecovery") return { worktree_merge_recovery: pending };
    });

    await openChanges();
    expect(await screen.findByText("Merge completed outside Ticketry.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Finish merge" })).not.toBeInTheDocument();
    view.unmount();

    pending = recovery({ outcome: "aborted", unmerged_paths: [] });
    mountMergeRecovery(async (operation) => {
      if (operation === "WorktreeMergePreview") return { worktree_merge_preview: preview() };
      if (operation === "WorktreeMergeRecovery") return { worktree_merge_recovery: pending };
    });
    await openChanges();
    expect(await screen.findByText("Merge was aborted outside Ticketry.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Abort merge" })).not.toBeInTheDocument();
  });

  it("[overhaul-321] retires finished and aborted recovery so the worktree can merge again", async () => {
    for (const action of ["finish", "abort"] as const) {
      let pending: Recovery | null = null;
      const operationIds: string[] = [];
      const view = mountMergeRecovery(async (operation, variables) => {
        if (operation === "WorktreeMergePreview") return { worktree_merge_preview: preview() };
        if (operation === "WorktreeMergeRecovery") return { worktree_merge_recovery: pending };
        if (operation === "WorktreeMergeFinish") {
          pending = null;
          return { worktree_merge_finish: recovery({ outcome: "merged", unmerged_paths: [] }) };
        }
        if (operation === "WorktreeMergeAbort") {
          pending = null;
          return { worktree_merge_abort: recovery({ outcome: "aborted", unmerged_paths: [] }) };
        }
        if (operation === "WorktreeMerge") {
          const operationId = (variables as { operationId: string }).operationId;
          operationIds.push(operationId);
          if (operationIds.length === 1) {
            pending = recovery({ operation_id: operationId, unmerged_paths: [] });
            return { worktree_merge: pending };
          }
          return { worktree_merge: recovery({ outcome: "merged", unmerged_paths: [] }) };
        }
      });

      await openChanges();
      fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }));
      fireEvent.click(await screen.findByRole("button", { name: `${action === "finish" ? "Finish" : "Abort"} merge` }));
      fireEvent.click(screen.getByRole("button", { name: `Confirm ${action}` }));

      fireEvent.click(await screen.findByRole("button", { name: "Merge into main" }));
      expect(operationIds).toHaveLength(2);
      expect(operationIds[1]).not.toBe(operationIds[0]);
      view.unmount();
    }
  });
});
