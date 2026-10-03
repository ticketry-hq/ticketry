import type { PlanningModule, PlanningWorkItem } from "../../planning-graph";
import type { SprintSuggestionRecordFragment } from "../generated/sprints.documents";

export const NO_EPIC = "__no_epic__";
export type PlanEpic = Pick<PlanningModule, "id" | "name">;
export type EpicSuggestion = Pick<SprintSuggestionRecordFragment, "sprintId" | "status" | "proposedEpicId"> & {
  issue: Pick<PlanningWorkItem, "moduleId"> | null;
};
export type EpicGraph = {
  modules: PlanEpic[];
  workItems: Pick<PlanningWorkItem, "id" | "moduleId" | "sprintId" | "typeName">[];
};

export function epicOf(item: Pick<PlanningWorkItem, "moduleId">, epics: readonly Pick<PlanEpic, "id">[]): string {
  return item.moduleId && epics.some((epic) => epic.id === item.moduleId) ? item.moduleId : NO_EPIC;
}

export function suggestionEpicOf(suggestion: EpicSuggestion, epics: readonly Pick<PlanEpic, "id">[]): string {
  return epicOf({ moduleId: suggestion.issue ? suggestion.issue.moduleId : suggestion.proposedEpicId }, epics);
}

export function planEpics(modules: readonly PlanEpic[]): PlanEpic[] {
  return [...modules, { id: NO_EPIC, name: "No epic" }];
}

export function waitingForEpic(suggestions: EpicSuggestion[], sprintId: string, epicId: string, epics: readonly Pick<PlanEpic, "id">[]): number {
  return suggestions.filter((suggestion) => suggestion.sprintId === sprintId && suggestion.status === "waiting" && suggestionEpicOf(suggestion, epics) === epicId).length;
}

export function availablePlanEpics(graph: EpicGraph, suggestions: EpicSuggestion[], sprintId: string): PlanEpic[] {
  const hasUngroupedStories = graph.workItems.some((item) => item.typeName === "Story" &&
    (item.sprintId === null || item.sprintId === sprintId) && epicOf(item, graph.modules) === NO_EPIC);
  return hasUngroupedStories || waitingForEpic(suggestions, sprintId, NO_EPIC, graph.modules) > 0
    ? planEpics(graph.modules) : graph.modules;
}
