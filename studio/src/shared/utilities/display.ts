// Shared visual metadata for workflow-state groups. Colors come from the
// shared lifecycle/accent tokens in tailwind.config.

import type { State } from "../api/types";

// The five workflow groups in their frozen left-to-right board order.
export const STATE_GROUP_ORDER = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

// Rank a state group for board-column ordering; unknown groups sort to the end.
export function groupRank(group: string): number {
  const i = (STATE_GROUP_ORDER as readonly string[]).indexOf(group);
  return i === -1 ? STATE_GROUP_ORDER.length : i;
}

// Order two workflow states by their canonical position (CODIN-859). The
// backend's `sort_order` is the primary key — it distinguishes Refinement from
// Ready and Implement from Review even though each pair shares a group, which
// group rank alone cannot. Group rank is only a fallback for states that carry
// no explicit order (older fixtures, synthetic "No State" rows).
export function compareStateOrder(
  a: { group?: string | null; sort_order?: number | null },
  b: { group?: string | null; sort_order?: number | null },
): number {
  const sa = a.sort_order;
  const sb = b.sort_order;
  if (typeof sa === "number" && typeof sb === "number" && sa !== sb) {
    return sa - sb;
  }
  return groupRank(a.group ?? "") - groupRank(b.group ?? "");
}

// The five workflow groups, each with a dot color used when a state carries no
// explicit color of its own.
const GROUP_COLOR: Record<string, string> = {
  backlog: "#5a6273",
  unstarted: "#7a8599",
  started: "#7dcfff",
  completed: "#9ece6a",
  cancelled: "#f7768e",
};

export function stateColor(state: State | null | undefined): string {
  if (!state) return GROUP_COLOR.backlog;
  return state.color || GROUP_COLOR[state.group] || GROUP_COLOR.backlog;
}

export function stateLabel(state: State | null | undefined): string {
  return state?.name ?? "No state";
}

// State groups that mark an issue resolved — a blocker in these groups no longer
// warns. Single source of truth for the "unresolved" signal used by blocker
// chips and blocker pickers.
export const RESOLVED_GROUPS = new Set(["completed", "cancelled"]);

export function isResolved(state: State | null | undefined): boolean {
  return RESOLVED_GROUPS.has(state?.group ?? "");
}

// Human-readable file size for an attachment row (#639 G02). A null size (the
// backend didn't record one) renders as an em-dash, not "0 B".
// Absolute calendar date for the issue metadata row (G07); "—" when missing
// or unparseable so a malformed timestamp never throws in render.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}
