import type { WorkItem } from "../../shared/api/types";
import {
  publicWorktrackerId,
  publicWorktrackerTimestamp,
} from "../../shared/api/generatedWorktracker";
import type { GeneratedWorkTrackerWorkItem } from "./generated/operations";

export function workItemFromIssue(item: GeneratedWorkTrackerWorkItem): WorkItem {
  return {
    id: publicWorktrackerId(item.id),
    name: item.name,
    project_id: publicWorktrackerId(item.project_id),
    sequence_id: item.sequence_id,
    state: item.state_id ? publicWorktrackerId(item.state_id) : null,
    state_revision: item.state_revision,
    description: item.description,
    parent_id: item.parent_id ? publicWorktrackerId(item.parent_id) : null,
    sub_issues_count: item.children.nodes.length,
    key: `${item.project?.slug ?? ""}-${item.sequence_id}`,
    is_archived: item.is_archived,
    created_at: publicWorktrackerTimestamp(item.created_at),
    updated_at: publicWorktrackerTimestamp(item.updated_at),
    rank: item.rank,
    issue_type: publicWorktrackerId(item.issue_type_id),
    blocked_by_ids: item.blocked_by_edges.nodes.map((edge) =>
      publicWorktrackerId(edge.to_issue_id)
    ),
    blocks_ids: item.blocks_edges.nodes.map((edge) =>
      publicWorktrackerId(edge.from_issue_id)
    ),
  };
}

export function orderedWorkItems(
  items: readonly GeneratedWorkTrackerWorkItem[],
): WorkItem[] {
  return items.map(workItemFromIssue).sort((left, right) =>
    left.rank.localeCompare(right.rank)
    || left.sequence_id - right.sequence_id
    || left.id.localeCompare(right.id)
  );
}
