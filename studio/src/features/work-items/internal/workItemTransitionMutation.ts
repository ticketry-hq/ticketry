import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  TransitionWorkTrackerWorkItemDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";
import { moduleListRefreshes } from "./moduleListRefreshes";
import { recordStoryMove, storyMoveError } from "./storyMoveDiagnostics";

export interface WorkItemTransition {
  id: string;
  stateId: string;
  /** The module list that shows the item. */
  moduleId?: string;
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

function transitionVariables({ id, stateId }: WorkItemTransition) {
  return { id: compactWorktrackerId(id), targetStateId: compactWorktrackerId(stateId) };
}

/** Move one work item to a workflow state and re-read its module. */
export const workItemTransitionMutation = declareMutation({
  document: TransitionWorkTrackerWorkItemDocument,
  variables: transitionVariables,
  root: "update_work_item",
  optimistic: ({ optimistic }) => optimistic,
  refresh: ({ moduleId }) => moduleListRefreshes([moduleId]),
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
  diagnostics: {
    requested: (args) => recordStoryMove("transition-requested", {
      ...transitionVariables(args),
      optimistic: Boolean(args.optimistic),
    }),
    written: (issue) => {
      const item = workItemFromIssue(issue);
      recordStoryMove("transition-succeeded", { id: item.id, stateId: item.state, rank: item.rank });
    },
    failed: (_phase, error, args) => recordStoryMove("transition-failed", {
      ...transitionVariables(args),
      error: storyMoveError(error),
    }, "error"),
  },
});
