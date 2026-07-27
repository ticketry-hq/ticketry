import type { WorkItem } from "../../../../shared/api/types";
import { isResolved } from "../../../../shared/utilities/display";

// CODIN-907: the Story-detail review-findings panel. A "finding" is a direct
// Implementation child the integration-review agent created under a Story in
// Review (CODIN-905); "queued" findings are the ones still in Ready — the head
// of the CODIN-901 fix campaign. These predicates are the single source of
// truth the panel and its count share.

/** Findings are the Story's direct Implementation children (CODIN-905). */
export function isFinding(item: WorkItem): boolean {
  return item.issue_type?.name === "Implementation";
}

/** Queued = Implementation AND still in Ready (the campaign-queue head). */
export function isQueuedFinding(item: WorkItem): boolean {
  return isFinding(item) && item.state?.name === "Ready";
}

/** The panel is Review-scoped on a Story; hidden for every other type/state. */
export function hasFindingsPanel(item: WorkItem): boolean {
  return item.issue_type?.name === "Story" && item.state?.name === "Review";
}

/** The Story's Implementation children, in the order the API returned them. */
export function findings(children: WorkItem[]): WorkItem[] {
  return children.filter(isFinding);
}

/** The "N fixes queued" count — Ready Implementation children only. */
export function queuedFindingCount(children: WorkItem[]): number {
  return children.filter(isQueuedFinding).length;
}

/** A cancellable finding is one not already resolved (Done / Cancelled). */
export function isCancellable(item: WorkItem): boolean {
  return !isResolved(item.state);
}

/** Parsed evidence block from a finding's description (CODIN-905 format). */
export interface FindingLocation {
  path: string;
  lineStart: number;
  lineEnd: number;
}

// Parse the fixed `Path:` / `Lines: start-end` block CODIN-905 writes into the
// finding's description (verbatim in description_html). There is no structured
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
