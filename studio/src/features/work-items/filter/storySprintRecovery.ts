import { getStorySprintReadsSnapshot } from "../../sprints";
import { getStorySprintFilterIntent, advanceStorySprintFilterGeneration, clearStorySprintFilter } from "../internal/storySprintFilterStore";
import { resolveStorySprintFilter, selectStorySprintResults } from "../selectors/storySprintFilter";
import { getModuleTreeSnapshot, getWorkItemSnapshot } from "../queries";
import { getProjectStorySprintIndexSnapshot } from "../queries/useProjectStorySprintIndex";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { WorkItem } from "../../../shared/api/types";
import { editionHas } from "../../../shared/config/edition";

export function capturedStoryOutsideResults(projectId: string, created: WorkItem, search: string): boolean {
  const selection = storySprintSelection(projectId);
  return !selectStorySprintResults(
    { rootIds: [created.id], children: { [created.id]: [] }, order: [created.id] },
    { [created.id]: created }, selection, search,
  ).resultIds.has(created.id);
}

function storySprintSelection(projectId: string) {
  if (!editionHas("sprintPlanning")) return { mode: "all" as const };
  const intent = getStorySprintFilterIntent(projectId);
  const reads = getStorySprintReadsSnapshot(projectId, intent.mode === "id" ? intent.sprintId : null);
  return resolveStorySprintFilter(intent, reads.active, reads.selected).selection;
}

/** Explicit navigation cancels old folder/restoration attempts before selection. */
export function prepareExplicitStoryReveal(projectId: string, moduleId: string, taskId: string | null): void {
  if (!editionHas("sprintPlanning")) return;
  const selection = storySprintSelection(projectId);
  const tree = getModuleTreeSnapshot(projectId, moduleId);
  const items = Object.fromEntries(tree.order.flatMap((id) => {
    const item = getWorkItemSnapshot(id);
    return item ? [[id, item]] : [];
  }));
  const eligible = taskId ? selectStorySprintResults(tree, items, selection, "").resultIds.has(taskId)
    : getProjectStorySprintIndexSnapshot(projectId).roots.some((root) =>
      root.module_id && compactWorktrackerId(root.module_id) === compactWorktrackerId(moduleId)
      && (selection?.mode === "all" || (selection?.mode === "none" ? root.sprint_id === null
        : selection?.mode === "id" && root.sprint_id !== null
          && compactWorktrackerId(root.sprint_id) === compactWorktrackerId(selection.sprintId))));
  if (selection?.mode !== "all" && !eligible) clearStorySprintFilter(projectId);
  else advanceStorySprintFilterGeneration(projectId);
}
