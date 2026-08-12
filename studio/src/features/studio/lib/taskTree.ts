import type { ModuleTree } from "../../../shared/api/types";
import type { TaskId, TaskState } from "./types";

const STATE_GROUP_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export interface TreeWorkItem {
  id: TaskId;
  name: string;
  key?: string | null;
  sequence_id: number | null;
  rank?: string;
  parent_id: string | null;
  state: string | null;
}

export interface OrderedTaskSection {
  state: TaskState;
  ids: TaskId[];
}

interface IndexedId {
  id: TaskId;
  index: number;
}

function compareRankAscending(
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  a: IndexedId,
  b: IndexedId,
): number {
  const aRank = itemsById[a.id]?.rank;
  const bRank = itemsById[b.id]?.rank;
  const aHasRank = typeof aRank === "string" && aRank.length > 0;
  const bHasRank = typeof bRank === "string" && bRank.length > 0;
  if (aHasRank && bHasRank) {
    if (aRank === bRank) return b.index - a.index;
    return aRank! < bRank! ? -1 : 1;
  }
  if (aHasRank) return -1;
  if (bHasRank) return 1;
  return b.index - a.index;
}

export function orderIdsByRank(
  ids: readonly TaskId[],
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  canonicalOrder: readonly TaskId[],
): TaskId[] {
  const orderIndex = new Map(canonicalOrder.map((id, index) => [id, index]));
  return ids
    .filter((id) => itemsById[id] !== undefined)
    .map((id, index) => ({ id, index: orderIndex.get(id) ?? index }))
    .sort((a, b) => compareRankAscending(itemsById, a, b))
    .map(({ id }) => id);
}

export function orderedTaskSections(
  rootIds: readonly TaskId[],
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  states: readonly TaskState[],
  canonicalOrder: readonly TaskId[] = rootIds,
): OrderedTaskSection[] {
  const groups: Record<string, TaskId[]> = {};
  for (const id of rootIds) {
    const stateId = itemsById[id]?.state;
    if (stateId) (groups[stateId] ??= []).push(id);
  }
  const orderedStates = [...states].sort((a, b) => {
    if (
      typeof a.sort_order === "number" &&
      typeof b.sort_order === "number" &&
      a.sort_order !== b.sort_order
    ) {
      return a.sort_order - b.sort_order;
    }
    return (
      (STATE_GROUP_ORDER[a.group.toLowerCase()] ?? 99) -
      (STATE_GROUP_ORDER[b.group.toLowerCase()] ?? 99)
    );
  });
  return orderedStates.map((state) => ({
    state,
    ids: orderIdsByRank(
      state.id ? groups[state.id] ?? [] : [],
      itemsById,
      canonicalOrder,
    ),
  }));
}

export interface WorkItemRow {
  kind: "work-item";
  id: TaskId;
  depth: number;
  parentId: TaskId | null;
  expandable: boolean;
  expanded: boolean;
}

export function searchHits(
  tree: ModuleTree,
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  query: string,
): Set<TaskId> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return new Set(tree.order);

  const parentById = new Map<TaskId, TaskId>();
  for (const [parentId, childIds] of Object.entries(tree.children)) {
    for (const childId of childIds) parentById.set(childId, parentId);
  }

  const hits = new Set<TaskId>();
  for (const id of tree.order) {
    const item = itemsById[id];
    if (!item) continue;
    const sequence = item.sequence_id === null ? "" : String(item.sequence_id);
    const matches =
      item.name.toLowerCase().includes(normalized) ||
      (item.key?.toLowerCase().includes(normalized) ?? false) ||
      sequence.includes(normalized);
    if (!matches) continue;

    let current: TaskId | undefined = id;
    const visited = new Set<TaskId>();
    while (current && !visited.has(current)) {
      visited.add(current);
      hits.add(current);
      current = parentById.get(current);
    }
  }
  return hits;
}

export function visibleRows(
  tree: ModuleTree,
  rootIds: readonly TaskId[],
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  expandedIds: ReadonlySet<TaskId>,
  includedIds: ReadonlySet<TaskId> | null = null,
): WorkItemRow[] {
  const rows: WorkItemRow[] = [];
  const visited = new Set<TaskId>();

  function append(id: TaskId, depth: number, parentId: TaskId | null): void {
    if (visited.has(id) || !itemsById[id] || (includedIds && !includedIds.has(id))) {
      return;
    }
    visited.add(id);
    const children = tree.children[id];
    const expandable = children === undefined || children.length > 0;
    const expanded = includedIds
      ? children?.some((childId) => includedIds.has(childId)) || expandedIds.has(id)
      : expandedIds.has(id);
    rows.push({ kind: "work-item", id, depth, parentId, expandable, expanded });
    if (!expanded || children === undefined) return;
    for (const childId of orderIdsByRank(children, itemsById, tree.order)) {
      append(childId, depth + 1, id);
    }
  }

  for (const id of rootIds) append(id, 0, null);
  return rows;
}

export function selectModuleTaskOrder(
  tree: ModuleTree,
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  states: readonly TaskState[],
): TaskId[];
export function selectModuleTaskOrder(
  tree: ModuleTree,
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  states: readonly TaskState[],
): TaskId[] {
  const order: TaskId[] = [];
  const visited = new Set<TaskId>();

  function appendBranch(id: TaskId): void {
    if (visited.has(id) || !itemsById[id]) return;
    visited.add(id);
    order.push(id);
    for (const childId of orderIdsByRank(
      tree.children[id] ?? [],
      itemsById,
      tree.order,
    )) {
      appendBranch(childId);
    }
  }

  for (const section of orderedTaskSections(
    tree.rootIds,
    itemsById,
    states,
    tree.order,
  )) {
    for (const id of section.ids) appendBranch(id);
  }
  return order;
}

export interface TaskRevealPath {
  ancestorIds: Set<TaskId>;
  stateId: string | null;
  stateName: string | null;
}

export function taskRevealPath(
  taskId: TaskId,
  tree: ModuleTree,
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  states: readonly TaskState[],
): TaskRevealPath;
export function taskRevealPath(
  taskId: TaskId,
  tree: ModuleTree,
  itemsById: Readonly<Record<TaskId, TreeWorkItem>>,
  states: readonly TaskState[],
): TaskRevealPath {
  const parentById = new Map<TaskId, TaskId>();
  for (const [parentId, children] of Object.entries(tree.children)) {
    for (const childId of children) parentById.set(childId, parentId);
  }

  const ancestorIds = new Set<TaskId>();
  const visited = new Set<TaskId>([taskId]);
  let current = taskId;
  let parent = parentById.get(current);
  while (parent && !visited.has(parent)) {
    ancestorIds.add(parent);
    visited.add(parent);
    current = parent;
    parent = parentById.get(current);
  }
  const stateId = itemsById[current]?.state ?? null;
  return {
    ancestorIds,
    stateId,
    stateName: states.find((state) => state.id === stateId)?.name ?? null,
  };
}
