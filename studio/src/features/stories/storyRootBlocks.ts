import {
  isPlanningRow,
  type PlanningRow,
  type PlanningTreeRow,
} from "../work-items";

export type StoryRootBlock =
  | { readonly kind: "row"; readonly row: Exclude<PlanningTreeRow, PlanningRow> }
  | { readonly kind: "block"; readonly rows: readonly PlanningRow[] };

/** Keep each root and its visible descendants together as one drag target. */
export function groupRootBlocks(
  rows: readonly PlanningTreeRow[],
): readonly StoryRootBlock[] {
  const grouped: (
    | { kind: "row"; row: Exclude<PlanningTreeRow, PlanningRow> }
    | { kind: "block"; rows: PlanningRow[] }
  )[] = [];
  for (const row of rows) {
    if (!isPlanningRow(row)) {
      grouped.push({ kind: "row", row });
    } else if (row.kind !== "work-item" || row.depth === 0) {
      grouped.push({ kind: "block", rows: [row] });
    } else {
      const previous = grouped[grouped.length - 1];
      if (previous?.kind === "block") previous.rows.push(row);
    }
  }
  return grouped;
}
