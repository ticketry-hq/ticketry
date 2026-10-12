import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import { DeleteWorkTrackerWorkItemDocument } from "../generated/workItems.documents";
import { moduleListRefreshes } from "./moduleListRefreshes";

export interface WorkItemDeletion {
  id: string;
  /** Every module list that may show the deleted row. */
  moduleIds: readonly (string | null | undefined)[];
}

/** Delete one work item: evict its identity and re-read the lists that showed it. */
export const workItemDeletionMutation = declareMutation({
  document: DeleteWorkTrackerWorkItemDocument,
  variables: ({ id }: WorkItemDeletion) => ({ id: compactWorktrackerId(id) }),
  root: "delete_work_item",
  optimistic: () => true,
  evict: ({ id }) => [{ __typename: "WorktrackerIssue", id: compactWorktrackerId(id) }],
  refresh: ({ moduleIds }) => moduleListRefreshes(moduleIds),
  result: () => undefined,
});
