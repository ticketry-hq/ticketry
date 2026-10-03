import {
  type PlanningWorkItem,
} from "../../planning-graph";
import type { groupSprintItemsByEpic } from "../selectors/sprintSelectors";

import { epicOf, NO_EPIC, type PlanEpic } from "./epicMembership";
export type PlanGroup = { epic: PlanEpic; items: PlanningWorkItem[] };
type SprintGroups = ReturnType<typeof groupSprintItemsByEpic>;

export { backlogCandidates } from "../../planning-graph";

/**
 * Items grouped by epic. With `only`, every chosen epic gets a group, even an
 * empty one, so it can say so and offer a new story; without it, empty groups drop.
 */
export function groupByEpic(epics: PlanEpic[], items: PlanningWorkItem[], only?: Set<string>): PlanGroup[] {
  return epics
    .filter((epic) => !only || only.has(epic.id))
    .map((epic) => ({ epic, items: items.filter((item) => epicOf(item, epics) === epic.id) }))
    .filter((group) => only || group.items.length > 0);
}

/** The sprint pane: every occupied sprint group, plus chosen epics left empty. */
export function sprintPaneGroups(epics: PlanEpic[], groups: SprintGroups, chosen: Set<string>): PlanGroup[] {
  const itemsByEpic = new Map(groups.map((group) => [group.epic?.id ?? NO_EPIC, group.items]));
  return epics
    .map((epic) => ({ epic, items: itemsByEpic.get(epic.id) ?? [] }))
    .filter((group) => group.items.length > 0 || chosen.has(group.epic.id))
    .sort((left, right) => Number(chosen.has(right.epic.id)) - Number(chosen.has(left.epic.id)));
}

/** "N items · M epics": all assigned items and the occupied epic groups. */
export function planSummary(groups: SprintGroups): { items: number; epics: number } {
  return { items: groups.reduce((sum, group) => sum + group.items.length, 0), epics: groups.length };
}
