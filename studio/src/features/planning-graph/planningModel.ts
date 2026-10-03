import type { PlanningGraphQuery } from "./generated/planningGraph.documents";

// The planner's read model: the PlanningGraph query adapted into the plain
// shapes the Plan and Sprints views render. Ids stay in their public
// (hyphenated) spelling on both sides of every relation.

export type SprintStatus = "planned" | "active" | "completed";

export interface PlanningState {
  id: string;
  name: string;
  group: string;
  color: string;
}

export interface PlanningSprint {
  id: string;
  name: string;
  status: SprintStatus;
  createdAt: string;
}

export interface PlanningModule {
  id: string;
  key: string;
  name: string;
}

export interface PlanningWorkItem {
  id: string;
  /** Display identifier, `SLUG-N`. */
  key: string;
  name: string;
  rank: string;
  parentId: string | null;
  moduleId: string | null;
  stateId: string | null;
  sprintId: string | null;
  updatedAt: string;
  typeName: string | null;
}

/** The one issue type a Plan control creates, or why there isn't one. */
export type CreationType = { id: string } | { error: string };

export interface PlanningGraph {
  project: { id: string; name: string; slug: string } | null;
  states: PlanningState[];
  /** The project's one Story issue type, used when creating stories. */
  storyType: CreationType;
  /** The project's one module-level type, used when creating epics. */
  epicType: CreationType;
  sprints: PlanningSprint[];
  /** Modules in Ticketry's manual tab order, then by sequence. */
  modules: PlanningModule[];
  workItems: PlanningWorkItem[];
  stateById: Map<string, PlanningState>;
}

export function adaptPlanningGraph(data: PlanningGraphQuery): PlanningGraph {
  const project = data.project.nodes[0] ?? null;
  const slug = project?.slug ?? "";
  const states = data.states.nodes.map(({ id, name, group, color }) => ({
    id,
    name,
    group,
    color,
  }));
  const modules = [...data.modules.nodes]
    .map((module) => ({
      module,
      rank: module.presentation.nodes[0]?.rank ?? "",
    }))
    .sort((a, b) => {
      // Manually ordered modules first (by rank), then the rest by sequence.
      if (a.rank && b.rank) return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
      if (a.rank || b.rank) return a.rank ? -1 : 1;
      return a.module.sequenceId - b.module.sequenceId;
    })
    .map(({ module }) => ({
      id: module.id,
      key: `${slug}-${module.sequenceId}`,
      name: module.name,
    }));
  return {
    project,
    states,
    storyType: storyTypeOf(data.issueTypes.nodes),
    epicType: epicTypeOf(data.issueTypes.nodes),
    sprints: data.sprints.nodes.map((sprint) => ({
      id: sprint.id,
      name: sprint.name,
      status: sprintStatus(sprint.status),
      createdAt: sprint.createdAt,
    })),
    modules,
    workItems: data.workItems.nodes.map((item) => ({
      id: item.id,
      key: `${slug}-${item.sequenceId}`,
      name: item.name,
      rank: item.rank,
      parentId: item.parentId,
      moduleId: item.moduleId,
      stateId: item.stateId,
      sprintId: item.sprintId,
      updatedAt: item.updatedAt,
      typeName: item.issueType?.name ?? null,
    })),
    stateById: new Map(states.map((state) => [state.id, state])),
  };
}

function storyTypeOf(types: Array<{ id: string; name: string; level: string }>): CreationType {
  const stories = types.filter((type) => type.level === "task" && type.name === "Story");
  if (stories.length === 1) return { id: stories[0].id };
  return {
    error: stories.length
      ? "More than one Story issue type is configured; keep one to create issues here."
      : "No Story issue type is configured for this project.",
  };
}

// Any module-level type is an epic type; there must be exactly one to pick.
function epicTypeOf(types: Array<{ id: string; level: string }>): CreationType {
  const modules = types.filter((type) => type.level === "module");
  if (modules.length === 1) return { id: modules[0].id };
  return {
    error: modules.length
      ? "More than one module-level issue type is configured; keep one to create epics here."
      : "No module-level Epic issue type is configured for this project.",
  };
}

/** The planning rule (#906): planning surfaces show Story cards. */
export function isStory(item: PlanningWorkItem): boolean {
  return item.typeName === "Story";
}

/**
 * An item is top-level when its parent is null,
 * a Module, or not in the live graph. Anything under a live work item nests.
 */
export function isTopLevelIn(graph: Pick<PlanningGraph, "modules" | "workItems">): (item: Pick<PlanningWorkItem, "parentId">) => boolean {
  const moduleIds = new Set(graph.modules.map((module) => module.id));
  const itemIds = new Set(graph.workItems.map((item) => item.id));
  return (item) => item.parentId === null || moduleIds.has(item.parentId) || !itemIds.has(item.parentId);
}

/** States arrive in the project's configured sortOrder from PlanningGraph. */
export function backlogStateIds(states: PlanningState[]): Set<string> {
  const boundary = states.findIndex((state) => state.name === "Implement");
  return new Set(states.slice(0, boundary + 1).map((state) => state.id));
}

export function backlogCandidateIn(graph: Pick<PlanningGraph, "modules" | "workItems" | "states">) {
  const isTopLevel = isTopLevelIn(graph);
  const eligibleStates = backlogStateIds(graph.states);
  return (item: Pick<PlanningWorkItem, "parentId" | "typeName" | "sprintId" | "stateId">): boolean =>
    item.sprintId === null && item.typeName === "Story" && isTopLevel(item) &&
    item.stateId !== null && eligibleStates.has(item.stateId);
}

export function backlogCandidates(graph: Pick<PlanningGraph, "modules" | "workItems" | "states">): PlanningWorkItem[] {
  return graph.workItems.filter(backlogCandidateIn(graph));
}

function sprintStatus(status: string): SprintStatus {
  switch (status) {
    case "planned":
    case "active":
    case "completed":
      return status;
    default:
      throw new Error(`Unknown sprint status: ${status}`);
  }
}
