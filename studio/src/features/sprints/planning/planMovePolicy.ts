import { backlogCandidateIn, backlogStateIds, isTopLevelIn, type PlanningGraph } from "../../planning-graph";
import { epicOf, type PlanEpic } from "./epicMembership";
import type { Move, MoveEligibility } from "./moveFeedback";

/** Shared displayed and command-time policy; reason order is deliberate. */
export function planMoveEligibility(graph: PlanningGraph | null, sprintId: string, epics: PlanEpic[], activeEpicId: string | null,
  unavailable: boolean, move: Move): MoveEligibility {
  const item = graph?.workItems.find((candidate) => candidate.id === move.itemId);
  const sprint = graph?.sprints.find((candidate) => candidate.id === sprintId);
  if (!graph || !sprint || !item || unavailable) return { kind: "unavailable" };
  if (move.to !== sprintId) return item.sprintId === sprintId ? { kind: "eligible" } : { kind: "unavailable" };
  if (sprint.status === "completed") return { kind: "closed" };
  if (!isTopLevelIn(graph)(item)) return { kind: "hierarchy" };
  if (item.stateId === null || !backlogStateIds(graph.states).has(item.stateId)) {
    return { kind: "workflow", stateName: graph.states.find((state) => state.id === item.stateId)?.name ?? "an unavailable workflow state" };
  }
  if (!backlogCandidateIn(graph)(item)) return { kind: "unavailable" };
  if (epicOf(item, epics) !== activeEpicId) return { kind: "focus", epicName: epics.find((epic) => epic.id === epicOf(item, epics))?.name ?? "No epic" };
  return { kind: "eligible" };
}
