import type { CreateWorkTrackerWorkItemMutationVariables } from "./generated/workItems.documents";

/** Caller supplies create fields; project identity comes from the feature context. */
export type WorkItemCreateVariables = Omit<CreateWorkTrackerWorkItemMutationVariables, "projectId">;

/** Derived hierarchy indexes identify membership and known child order, not server rows. */
export interface ModuleTree {
  rootIds: string[];
  /** Absent key = children have not been read; [] = known childless. */
  children: Record<string, string[]>;
  /** Canonical server order for deterministic rankless fallbacks. */
  order: string[];
}

/** Client query choices describe a list view rather than persisted WorkItem fields. */
export interface WorkItemFilters {
  parent?: string;
  state?: string;
}
