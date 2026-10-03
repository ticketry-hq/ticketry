import type {
  PlanningGraph,
  PlanningModule,
  PlanningSprint,
  PlanningState,
  PlanningWorkItem,
} from "./planningModel";

// Small planning graphs for selector and view tests.

export function workItem(partial: Partial<PlanningWorkItem> & { id: string }): PlanningWorkItem {
  return {
    key: `PLAN-${partial.id}`,
    name: partial.id,
    rank: "V",
    parentId: null,
    moduleId: null,
    stateId: "idea",
    sprintId: null,
    updatedAt: "2026-06-01 00:00:00",
    typeName: "Story",
    ...partial,
  };
}

export function sprint(partial: Partial<PlanningSprint> & { id: string }): PlanningSprint {
  return {
    name: partial.id,
    status: "planned",
    createdAt: "2026-06-01 00:00:00",
    ...partial,
  };
}

export const MODULES: PlanningModule[] = [
  { id: "m1", key: "PLAN-1", name: "Auth" },
  { id: "m2", key: "PLAN-2", name: "API" },
];

export const STATES: PlanningState[] = [
  { id: "idea", name: "Idea", group: "backlog", color: "#888" },
  { id: "implement", name: "Implement", group: "started", color: "#888" },
  { id: "review", name: "Review", group: "started", color: "#888" },
  { id: "done", name: "Done", group: "completed", color: "#9ece6a" },
];

export function graphOf(
  workItems: PlanningWorkItem[],
  sprints: PlanningSprint[] = [],
  modules: PlanningModule[] = MODULES,
): PlanningGraph {
  return {
    project: { id: "p1", name: "Planner", slug: "PLAN" },
    states: STATES,
    storyType: { id: "story-type" },
    epicType: { id: "epic-type" },
    sprints,
    modules,
    workItems,
    stateById: new Map(STATES.map((state) => [state.id, state])),
  };
}
