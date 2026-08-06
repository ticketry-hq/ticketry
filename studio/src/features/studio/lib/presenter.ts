import type { TaskState } from "./types";

interface PresentableWorkItem {
  id: string;
  state: { name: string } | null;
}

const STATE_GROUP_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export interface GroupedTasks {
  groups: Record<string, string[]>;
  orderedStates: TaskState[];
}

/** Group membership ids while resolving every displayed field from its entry. */
export function groupAndOrderTasks(
  items: readonly PresentableWorkItem[],
  states: readonly TaskState[],
): GroupedTasks;
export function groupAndOrderTasks(
  ids: readonly string[],
  itemsById: Readonly<Record<string, PresentableWorkItem>>,
  states: readonly TaskState[],
): GroupedTasks;
export function groupAndOrderTasks(
  idsOrItems: readonly string[] | readonly PresentableWorkItem[],
  itemsOrStates: Readonly<Record<string, PresentableWorkItem>> | readonly TaskState[],
  maybeStates?: readonly TaskState[],
): GroupedTasks {
  const legacy = maybeStates === undefined;
  const ids = legacy
    ? (idsOrItems as readonly PresentableWorkItem[]).map((item) => item.id)
    : idsOrItems as readonly string[];
  const itemsById = legacy
    ? Object.fromEntries(
        (idsOrItems as readonly PresentableWorkItem[]).map((item) => [item.id, item]),
      )
    : itemsOrStates as Readonly<Record<string, PresentableWorkItem>>;
  const states = (legacy ? itemsOrStates : maybeStates) as readonly TaskState[];
  const groups: Record<string, string[]> = {};
  for (const id of ids) {
    const stateName = itemsById[id]?.state?.name;
    if (!stateName) continue;
    (groups[stateName] ??= []).push(id);
  }

  const orderedStates = [...states].sort((a, b) => {
    const sa = a.sort_order;
    const sb = b.sort_order;
    if (typeof sa === "number" && typeof sb === "number" && sa !== sb) {
      return sa - sb;
    }
    const ag = STATE_GROUP_ORDER[(a.group ?? "").toLowerCase()] ?? 99;
    const bg = STATE_GROUP_ORDER[(b.group ?? "").toLowerCase()] ?? 99;
    return ag - bg;
  });

  return { groups, orderedStates };
}
