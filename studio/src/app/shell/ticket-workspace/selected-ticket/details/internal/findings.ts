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

/** Parsed evidence block from a finding's description (CODIN-905 format). */
export interface FindingLocation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

// Parse the fixed `Path:` / `Lines: start-end` block CODIN-905 writes into the
// finding's canonical description. There is no structured
// location field on the WorkItem, so the panel reads it back out of the text.
// Returns null when either line is absent or malformed — the panel then simply
// omits the location rather than showing a broken one.
export function parseFindingLocation(
  description: string | null | undefined,
): FindingLocation | null {
  if (!description) return null;
  const pathMatch = description.match(/^\s*Path:\s*(.+?)\s*$/m);
  const linesMatch = description.match(/^\s*Lines:\s*(\d+)\s*-\s*(\d+)\s*$/m);
  if (!pathMatch || !linesMatch) return null;
  const lineStart = Number(linesMatch[1]);
  const lineEnd = Number(linesMatch[2]);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) return null;
  return { path: pathMatch[1], lineStart, lineEnd };
}

/** Compact "path:start-end" label for a finding row; null when unparseable. */
export function formatFindingLocation(
  description: string | null | undefined,
): string | null {
  const loc = parseFindingLocation(description);
  if (!loc) return null;
  return `${loc.path}:${loc.lineStart}-${loc.lineEnd}`;
}
