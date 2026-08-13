import type { WorkItemRow } from "./taskTree";

export interface ScratchRow {
  kind: "scratch";
  moduleId: string;
}

export type PlanningRow = WorkItemRow | ScratchRow;

export const LOADING_PLACEHOLDER = Symbol("loading-placeholder");
export const STATE_HEADER = Symbol("state-header");

export type PlanningTreeRow =
  | PlanningRow
  | { kind: typeof LOADING_PLACEHOLDER; key: string; depth: number }
  | {
      kind: typeof STATE_HEADER;
      key: string;
      stateId?: string | null;
      stateName: string;
      stateColor: string;
      count: number;
    };

export function isPlanningRow(row: PlanningTreeRow): row is PlanningRow {
  return row.kind === "work-item" || row.kind === "scratch";
}
