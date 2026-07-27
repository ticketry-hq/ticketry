import type { WorkItem } from "../../../shared/api/types";

export type DependencyEdgeField = "blocked_by_ids" | "blocks_ids";

/**
 * Ids reachable from `startId` by following the given dependency edge fields,
 * bounded by `maxHops` (default unbounded). The start id is not included.
 *
 * The traversal is deliberately store-free so both kept field controls and
 * the dependency view can use the same cycle-safe graph primitive.
 */
export function reachable(
  startId: string,
  items: WorkItem[],
  fields: DependencyEdgeField[],
  maxHops: number = Infinity,
): Set<string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const distances = new Map<string, number>([[startId, 0]]);
  const reachableIds = new Set<string>();
  const queue: string[] = [startId];

  while (queue.length) {
    const currentId = queue.shift()!;
    const distance = distances.get(currentId)!;
    if (distance >= maxHops) continue;

    const item = byId.get(currentId);
    if (!item) continue;

    for (const field of fields) {
      for (const neighborId of item[field]) {
        if (distances.has(neighborId)) continue;
        distances.set(neighborId, distance + 1);
        reachableIds.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  return reachableIds;
}
