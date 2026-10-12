import type { WorkItemCreate } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { declareMutation } from "../../../shared/apollo/declaredMutation";
import {
  CreateWorkTrackerWorkItemDocument,
  WorkTrackerModuleOpenDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { workItemFromIssue } from "../issueAdapter";
import { recordLocalWorkItemConvergence } from "../workItemConvergence";
import { moduleListRefreshes } from "./moduleListRefreshes";

export interface WorkItemCreation {
  projectId: string;
  body: WorkItemCreate & { issue_type_id: string };
  /** The module list that shows the created row. */
  moduleId?: string;
  optimistic?: GeneratedWorkTrackerWorkItemFieldsFragment;
}

/** Create one work item; it appears once in its exact module list. */
export const workItemCreationMutation = declareMutation({
  document: CreateWorkTrackerWorkItemDocument,
  variables: ({ projectId, body }: WorkItemCreation) => ({
    projectId: compactWorktrackerId(projectId),
    name: body.name ?? "",
    issueTypeId: compactWorktrackerId(body.issue_type_id),
    description: body.description,
    stateId: body.state_id ? compactWorktrackerId(body.state_id) : body.state_id,
    parentId: body.parent_id ? compactWorktrackerId(body.parent_id) : body.parent_id,
  }),
  root: "create_work_item",
  optimistic: ({ optimistic }) => optimistic,
  // Append the created row and strip the optimistic row, so it shows once.
  membership: (cache, created, { moduleId }) => {
    if (!moduleId) return;
    cache.updateQuery({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: compactWorktrackerId(moduleId) },
    }, (current) => current && {
      ...current,
      work_items: {
        ...current.work_items,
        nodes: [
          ...current.work_items.nodes.filter((row) =>
            row.id !== created.id && !row.id.startsWith("optimistic:")
          ),
          created,
        ],
      },
    });
  },
  refresh: ({ moduleId }) => moduleListRefreshes([moduleId]),
  committed: (issue) => recordLocalWorkItemConvergence(issue.id, issue.updated_at),
  result: (issue) => workItemFromIssue(issue),
});
