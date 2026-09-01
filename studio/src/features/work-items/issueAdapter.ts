import type { WorkItem } from "../../shared/api/types";
import {
  publicWorktrackerId,
  publicWorktrackerTimestamp,
} from "../../shared/api/generatedWorktracker";
import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";

export function workItemFromIssue(item: GeneratedWorkTrackerWorkItemFieldsFragment): WorkItem {
  return {
    id: publicWorktrackerId(item.id),
    name: item.name,
    project_id: publicWorktrackerId(item.project_id),
    sequence_id: item.sequence_id,
    state: item.state_id ? publicWorktrackerId(item.state_id) : null,
    description: item.description,
    parent_id: item.parent_id ? publicWorktrackerId(item.parent_id) : null,
    sub_issues_count: item.children.nodes.filter((child) =>
      !("is_archived" in child) || !child.is_archived
    ).length,
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

// Ranks are base-62 fractional-index keys the server compares byte-wise
// (`0-9 < A-Z < a-z`). Locale collation folds case, so it reports "a" before
// "V" and scrambles any order that mixes cases; compare code units instead.
function compareRankKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderedWorkItems(
  items: readonly GeneratedWorkTrackerWorkItemFieldsFragment[],
): WorkItem[] {
  return items.map(workItemFromIssue).sort((left, right) =>
    compareRankKeys(left.rank, right.rank)
    || left.sequence_id - right.sequence_id
    || compareRankKeys(left.id, right.id)
  );
}
