import type { TaskState, TaskSummary } from "./types";

// The five workflow groups in board order. Only a fallback rank for states
// with no explicit `sort_order` — the canonical order (CODIN-859) comes from
// each state's `sort_order`, which distinguishes Refinement/Ready and
// Implement/Review inside their shared groups.
const STATE_GROUP_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export interface GroupedTasks {
  groups: Record<string, TaskSummary[]>;
  orderedStates: TaskState[];
}

/**
 * Port of tui/presenter.py:group_and_order_tasks. Groups tasks by state name
 * and returns an ordered state list matching the TUI's display ordering
 * (backlog → unstarted → started → completed → cancelled, then any leftovers
 * appended in insertion order).
 */
export function groupAndOrderTasks(
  tasks: TaskSummary[],
  states: TaskState[],
): GroupedTasks {
  const groups: Record<string, TaskSummary[]> = {};
  for (const task of tasks) {
    const stateName = task.state?.name ?? "Unknown";
    if (!groups[stateName]) groups[stateName] = [];
    groups[stateName].push(task);
  }

  const orderedStates = [...states].sort((a, b) => {
    // sort_order is the primary workflow key; group rank is the fallback for
    // states that carry no explicit order.
    const sa = a.sort_order;
    const sb = b.sort_order;
    if (typeof sa === "number" && typeof sb === "number" && sa !== sb) {
      return sa - sb;
    }
    const ag = STATE_GROUP_ORDER[(a.group ?? "").toLowerCase()] ?? 99;
    const bg = STATE_GROUP_ORDER[(b.group ?? "").toLowerCase()] ?? 99;
    return ag - bg;
  });

  const seenNames = new Set(orderedStates.map((s) => s.name));
  for (const name of Object.keys(groups)) {
    if (!seenNames.has(name)) {
      orderedStates.push({ id: null, name, group: "", color: null });
      seenNames.add(name);
    }
  }

  return { groups, orderedStates };
}
