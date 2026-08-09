import type { Module } from "../../../shared/api/types";

/**
 * Turn a resolved Module drop into the write the server expects (#360).
 *
 * The one cached Canonical module order is the only input: the post-drop array
 * Studio shows optimistically, the two neighbor ids the server ranks between,
 * and the pre-drop array that may become the project's first-drag baseline all
 * come from it. Nothing here knows whether the project is already in Manual
 * module order — the server decides that under its own lock, and simply
 * ignores a baseline it no longer needs.
 */
export interface ModuleReorderPlan {
  /** The order to show immediately, and to roll back from on failure. */
  readonly order: Module[];
  readonly beforeId: string | null;
  readonly afterId: string | null;
  /** The exact order the user could see when the drag started. */
  readonly initialOrderIds: string[];
}

/**
 * Plan a drop of `moduleId` near/far of `targetId`, or return `null` when the
 * gesture would not move anything. A no-op must not become a write: dropping a
 * Module onto itself, or onto the edge it already occupies, leaves the order
 * identical and there is nothing to persist.
 */
export function planModuleReorder(
  order: readonly Module[],
  moduleId: string,
  targetId: string,
  intent: "near" | "far",
): ModuleReorderPlan | null {
  const from = order.findIndex((module) => module.id === moduleId);
  const targetIndex = order.findIndex((module) => module.id === targetId);
  if (from === -1 || targetIndex === -1 || moduleId === targetId) return null;

  const remaining = order.filter((module) => module.id !== moduleId);
  const anchor = remaining.findIndex((module) => module.id === targetId);
  const to = intent === "near" ? anchor : anchor + 1;

  const next = [...remaining];
  next.splice(to, 0, order[from]);
  if (next.every((module, index) => module.id === order[index].id)) return null;

  return {
    order: next,
    beforeId: next[to - 1]?.id ?? null,
    afterId: next[to + 1]?.id ?? null,
    initialOrderIds: order.map((module) => module.id),
  };
}
