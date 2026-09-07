import { getStatesSnapshot } from "../../projects/stateCatalog";
import { selectModuleTaskOrder, type TreeWorkItem } from "../selectors/taskTree";
import { getModuleTreeSnapshot, getWorkItemSnapshot } from ".";

/** Work-item ids in the order the Stories tree lists them, read from cache. */
export function getModuleTaskOrderSnapshot(
  projectId: string | null,
  moduleId: string | null,
): string[] {
  if (!moduleId) return [];
  const tree = getModuleTreeSnapshot(projectId, moduleId);
  const itemsById = Object.fromEntries(tree.order.flatMap((id) => {
    const item = getWorkItemSnapshot(id);
    return item ? [[id, item] as const] : [];
  })) as unknown as Record<string, TreeWorkItem>;
  return selectModuleTaskOrder(tree, itemsById, getStatesSnapshot(projectId));
}
