import type { PlanVisit } from "../planWorkspaceState";
import { NO_EPIC, type EpicGraph, type EpicSuggestion, type PlanEpic } from "./epicMembership";

export function seedEpicTabs(_graph: EpicGraph, _suggestions: EpicSuggestion[], _sprintId: string): PlanVisit {
  return { epicTabs: [], activeEpicId: null };
}

export function reconcileEpicTabs(visit: PlanVisit, epics: PlanEpic[]): PlanVisit {
  const available = new Set(epics.map((epic) => epic.id));
  const normalize = (id: string) => available.has(id) ? id : available.has(NO_EPIC) ? NO_EPIC : null;
  const epicTabs = [...new Set(visit.epicTabs.flatMap((id) => {
    const normalized = normalize(id);
    return normalized ? [normalized] : [];
  }))];
  const active = visit.activeEpicId ? normalize(visit.activeEpicId) : null;
  return { epicTabs, activeEpicId: active && epicTabs.includes(active) ? active : epicTabs[0] ?? null };
}

export function closeEpicTab(visit: PlanVisit, epicId: string): PlanVisit {
  const index = visit.epicTabs.indexOf(epicId);
  const epicTabs = visit.epicTabs.filter((id) => id !== epicId);
  return { epicTabs, activeEpicId: visit.activeEpicId === epicId ? epicTabs[index] ?? epicTabs[index - 1] ?? null : visit.activeEpicId };
}

export function stepEpicTab(visit: PlanVisit, direction: 1 | -1): PlanVisit {
  const length = visit.epicTabs.length;
  if (!length) return visit;
  const index = visit.activeEpicId === null ? -1 : visit.epicTabs.indexOf(visit.activeEpicId);
  return { ...visit, activeEpicId: visit.epicTabs[(index + direction + length) % length] ?? null };
}
