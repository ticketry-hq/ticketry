import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { IssueType } from "../../workflows";
import type { GeneratedWorkTrackerWorkItemFieldsFragment as Issue, ReparentWorkTrackerWorkItemMutationVariables, SetWorkTrackerBlockersMutationVariables } from "../generated/workItems.documents";

export function optimisticIssueType(current: Issue, issueType: IssueType): Issue {
  return { ...current, issue_type_id: compactWorktrackerId(issueType.id), issue_type_record: {
    id: compactWorktrackerId(issueType.id), name: issueType.name, level: issueType.level,
    color: issueType.color ?? "", sort_order: issueType.sort_order,
  } };
}

export function optimisticParent(current: Issue, parentId: ReparentWorkTrackerWorkItemMutationVariables["parentId"]): Issue {
  return { ...current, parent_id: parentId ? compactWorktrackerId(parentId) : null };
}

let optimisticBlockerEdgeSequence = 0;
export function optimisticBlockers(current: Issue, blockedByIds: SetWorkTrackerBlockersMutationVariables["blockedByIds"]): Issue {
  const ids = Array.isArray(blockedByIds) ? blockedByIds : [blockedByIds];
  return { ...current, blocked_by_edges: { nodes: ids.map((id) => ({
    id: -(++optimisticBlockerEdgeSequence), to_issue_id: compactWorktrackerId(id),
  })) } };
}
