import type { IssueType, State, WorkItem } from "../../../../../../shared/api/types";
import { isResolved } from "../../../../../../shared/utilities/display";

// CODIN-907: the Story-detail review-findings panel. A "finding" is a direct
// Implementation child the integration-review agent created under a Story in
// Review (CODIN-905); findings at the Implementation start stage have not left
// the ordinary Implementation path. These predicates are the single source of
// truth the panel and its count share.

/** Findings are the Story's direct Implementation children (CODIN-905). */
export function isFinding(item: WorkItem, implementationTypeId: string | null): boolean {
  return item.issue_type === implementationTypeId;
}

/** Queued = Implementation AND still at the Implementation start stage. */
export function isQueuedFinding(
  item: WorkItem,
  implementationTypeId: string | null,
  implementStateId: string | null,
): boolean {
  return isFinding(item, implementationTypeId) && item.state === implementStateId;
}

/** The panel is Review-scoped on a Story; hidden for every other type/state. */
export function hasFindingsPanel(
  item: WorkItem,
  states: readonly State[],
  issueTypes: readonly IssueType[],
): boolean {
  const reviewStateId = states.find((state) => state.name === "Review")?.id ?? null;
  const storyTypeId = issueTypes.find((type) => type.name === "Story")?.id ?? null;
  return item.issue_type === storyTypeId && item.state === reviewStateId;
}

/** The Story's Implementation children, in the order the API returned them. */
export function findings(children: WorkItem[], implementationTypeId: string | null): WorkItem[] {
  return children.filter((item) => isFinding(item, implementationTypeId));
}

/** The "N fixes queued" count — start-stage Implementation children only. */
export function queuedFindingCount(
  children: WorkItem[],
  implementationTypeId: string | null,
  implementStateId: string | null,
): number {
  return children.filter((item) =>
    isQueuedFinding(item, implementationTypeId, implementStateId),
  ).length;
}

/** A cancellable finding is one not already resolved (Done / Cancelled). */
export function isCancellable(item: WorkItem, states: readonly State[]): boolean {
  return !isResolved(states.find((state) => state.id === item.state));
}

export { parseFindingLocation, formatFindingLocation, type FindingLocation } from "../../../../../../features/work-items/findingLocation";
