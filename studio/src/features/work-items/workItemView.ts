import type { GeneratedWorkTrackerWorkItemFieldsFragment } from "./generated/workItems.documents";

/** The shared conversion seam preserves the generated fragment's field types. */
export type WorkItemRow = GeneratedWorkTrackerWorkItemFieldsFragment;

export interface WorkItemDerived {
  readonly key: string;
  readonly sub_issues_count: number;
  /** Any direct child, including archived and completed ones. */
  readonly has_children: boolean;
  readonly blocked_by_ids: string[];
  readonly blocks_ids: string[];
}

/** Retained domain view exists only to add computed values to generated rows. */
export type WorkItem = WorkItemRow & WorkItemDerived;

export function workItemKey(row: WorkItemRow): string {
  return `${row.project?.slug ?? ""}-${row.sequence_id}`;
}

export function workItemSubIssuesCount(row: WorkItemRow): number {
  return row.children.nodes.filter((child) => !child.is_archived).length;
}

export function workItemHasChildren(row: WorkItemRow): boolean {
  return row.children.nodes.length > 0;
}

export function workItemBlockedByIds(row: WorkItemRow): string[] {
  return row.blocked_by_edges.nodes.map((edge) => edge.to_issue_id);
}

export function workItemBlocksIds(row: WorkItemRow): string[] {
  return row.blocks_edges.nodes.map((edge) => edge.from_issue_id);
}

/** Accept only a row already converted at its read or mutation result boundary. */
export function workItemView(row: WorkItemRow): WorkItem {
  return {
    ...row,
    key: workItemKey(row),
    sub_issues_count: workItemSubIssuesCount(row),
    has_children: workItemHasChildren(row),
    blocked_by_ids: workItemBlockedByIds(row),
    blocks_ids: workItemBlocksIds(row),
  };
}

// Ranks are base-62 fractional-index keys: server byte order is 0-9 < A-Z < a-z.
function compareRankKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderedWorkItems(rows: readonly WorkItemRow[]): WorkItem[] {
  return rows.map(workItemView).sort((left, right) =>
    compareRankKeys(left.rank, right.rank)
    || left.sequence_id - right.sequence_id
    || compareRankKeys(left.id, right.id)
  );
}
