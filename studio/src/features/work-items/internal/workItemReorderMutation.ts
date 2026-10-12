import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  ReorderWorkTrackerWorkItemDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";
import { moduleListRefreshes } from "./moduleListRefreshes";
import { recordStoryMove, storyMoveError } from "./storyMoveDiagnostics";

export interface WorkItemReorder {
  id: string;
  beforeId: string | null;
  afterId: string | null;
  initialOrderIds?: string[] | null;
  /** The module list whose sibling ranks the server may rebalance. */
  moduleId?: string;
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

function reorderVariables({ id, beforeId, afterId, initialOrderIds }: WorkItemReorder) {
  return {
    id: compactWorktrackerId(id),
    beforeId: beforeId ? compactWorktrackerId(beforeId) : null,
    afterId: afterId ? compactWorktrackerId(afterId) : null,
    initialOrderIds: initialOrderIds?.map(compactWorktrackerId),
  };
}

/**
 * Move one work item between two siblings. Rebalancing can change every
 * sibling rank, so the exact module list is re-read.
 */
export const workItemReorderMutation = declareMutation({
  document: ReorderWorkTrackerWorkItemDocument,
  variables: reorderVariables,
  root: "reorder_work_item",
  optimistic: ({ optimistic }) => optimistic,
  refresh: ({ moduleId }) => moduleListRefreshes([moduleId]),
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
  diagnostics: {
    requested: (args) => recordStoryMove("reorder-requested", {
      ...reorderVariables(args),
      moduleId: args.moduleId ?? null,
      optimistic: Boolean(args.optimistic),
    }),
    written: (issue) => {
      const item = workItemFromIssue(issue);
      recordStoryMove("reorder-mutation-succeeded", {
        id: item.id,
        stateId: item.state,
        rank: item.rank,
      });
    },
    refreshed: (issue, { moduleId }) => recordStoryMove("reorder-refresh-succeeded", {
      id: workItemFromIssue(issue).id,
      moduleId,
    }),
    failed: (phase, error, args) => recordStoryMove("reorder-failed", {
      ...reorderVariables(args),
      moduleId: args.moduleId ?? null,
      phase: phase === "write" ? "mutation" : "module-refresh",
      error: storyMoveError(error),
    }, "error"),
  },
});
