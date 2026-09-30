import { getStatesSnapshot } from "../../projects";
import {
  getModuleTreeSnapshot,
  getWorkItemSnapshot,
  taskRevealPath,
  type TreeWorkItem,
} from "../../work-items";
import { useClientStore } from "../../../state/clientStore";

/** Reveal the story without taking typing focus away from its agent. */
export function revealRunStory(projectId: string | null, moduleId: string, taskId: string): void {
  const workspace = useClientStore.getState();
  const tree = getModuleTreeSnapshot(projectId, moduleId);
  const items = Object.fromEntries(tree.order.flatMap((id) => {
    const item = getWorkItemSnapshot(id);
    return item ? [[id, item]] : [];
  })) as unknown as Record<string, TreeWorkItem>;
  const path = taskRevealPath(taskId, tree, items, getStatesSnapshot(projectId));
  workspace.expandMany(moduleId, [...path.ancestorIds]);
  if (path.stateId && workspace.collapsedStateIds.has(path.stateId)) {
    workspace.toggleStateCollapsed(path.stateId);
  }
  workspace.setStorySearchQuery("");

  // Expansion must commit before looking for a row that was previously hidden.
  // Also run when the same pad is pressed again after manually scrolling away.
  requestAnimationFrame(() => {
    const current = useClientStore.getState();
    if (current.selectedModuleId !== moduleId || current.selectedTaskId !== taskId) return;
    const row = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-pane="tasks"] [data-task-id]',
    )).find((element) => element.dataset.taskId === taskId);
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
