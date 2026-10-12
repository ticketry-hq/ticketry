import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  SetWorkTrackerBlockersDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";
import { moduleListRefreshes } from "./moduleListRefreshes";

export interface WorkItemBlockers {
  id: string;
  blockedByIds: readonly string[];
  /** The module list that shows the item. */
  moduleId?: string;
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

/** Replace one work item's blockers and re-read its module. */
export const workItemBlockersMutation = declareMutation({
  document: SetWorkTrackerBlockersDocument,
  variables: ({ id, blockedByIds }: WorkItemBlockers) => ({
    id: compactWorktrackerId(id),
    blockedByIds: blockedByIds.map(compactWorktrackerId),
  }),
  root: "update_work_item",
  optimistic: ({ optimistic }) => optimistic,
  refresh: ({ moduleId }) => moduleListRefreshes([moduleId]),
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
});
