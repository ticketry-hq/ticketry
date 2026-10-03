import type { PlanningGraph, PlanningSprint } from "../../planning-graph";

export function sprintProgress(graph: PlanningGraph, sprintId: string) {
  const items = graph.workItems.filter((item) => item.sprintId === sprintId);
  const done = items.filter((item) => {
    const group = item.stateId ? graph.stateById.get(item.stateId)?.group : undefined;
    return group === "completed" || group === "cancelled";
  }).length;
  return { done, total: items.length };
}

export function groupSprintItemsByEpic(graph: PlanningGraph, sprint: PlanningSprint) {
  const items = graph.workItems.filter((item) => item.sprintId === sprint.id);
  const moduleIds = new Set(graph.modules.map((module) => module.id));
  const groups = graph.modules.map((epic) => ({
    epic, items: items.filter((item) => item.moduleId === epic.id),
  })).filter((group) => group.items.length > 0);
  const loose = items.filter((item) => !item.moduleId || !moduleIds.has(item.moduleId));
  return loose.length ? [...groups, { epic: null, items: loose }] : groups;
}
