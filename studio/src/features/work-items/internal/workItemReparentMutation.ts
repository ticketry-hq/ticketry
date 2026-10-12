import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  ReparentWorkTrackerWorkItemDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";
import { moduleListRefreshes } from "./moduleListRefreshes";

export interface WorkItemReparent {
  id: string;
  parentId: string | null;
  /** The caller's module lists that showed the item before the move. */
  moduleIds: readonly (string | null | undefined)[];
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

/**
 * Move one work item under a new parent. A cross-module move re-reads the
 * caller's source modules and the destination module the server returns.
 */
export const workItemReparentMutation = declareMutation({
  document: ReparentWorkTrackerWorkItemDocument,
  variables: ({ id, parentId }: WorkItemReparent) => ({
    id: compactWorktrackerId(id),
    parentId: parentId ? compactWorktrackerId(parentId) : null,
  }),
  root: "update_work_item",
  optimistic: ({ optimistic }) => optimistic,
  refresh: ({ moduleIds }, moved) => moduleListRefreshes([...moduleIds, moved.module_id]),
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
});
