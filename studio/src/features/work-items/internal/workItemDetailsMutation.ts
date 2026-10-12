import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  UpdateWorkTrackerWorkItemDetailsDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";

export interface WorkItemDetailsPatch {
  name?: string;
  description?: string | null;
  issue_type_id?: string;
}

export interface WorkItemDetailsEdit {
  id: string;
  patch: WorkItemDetailsPatch;
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

/** Rename, description edit and type change: one row, no list membership change. */
export const workItemDetailsMutation = declareMutation({
  document: UpdateWorkTrackerWorkItemDetailsDocument,
  variables: ({ id, patch }: WorkItemDetailsEdit) => ({
    id: compactWorktrackerId(id),
    name: patch.name,
    description: patch.description,
    issueTypeId: patch.issue_type_id ? compactWorktrackerId(patch.issue_type_id) : undefined,
  }),
  root: "update_work_item",
  optimistic: ({ optimistic }) => optimistic,
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
});
