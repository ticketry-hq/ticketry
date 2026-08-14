import { fetchModuleActivity, sortModulesByRecency } from "./moduleRecency";
import {
  forgetNewlyCreatedModules,
  newlyCreatedModulesAwaitingActivity,
} from "../internal/newlyCreatedModules";
import type { Module, Project } from "../../../shared/api/types";

/**
 * The Canonical module order rule, in one place (#359).
 *
 * The server already returns a project's modules in a deterministic order that
 * depends on the project's durable ordering mode: newest-created-first while
 * the project is automatic, ascending persisted fractional rank once it has a
 * Manual module order. This module decides what Studio is allowed to layer on
 * top of that server order:
 *
 * - **Automatic**: agent-activity recency, newest activity first, over the
 *   server order, with modules this client has just created still leading it
 *   (#366). An activity lookup failure is already swallowed by
 *   `fetchModuleActivity` into an empty map, which leaves the server's
 *   fallback order exactly as it arrived.
 * - **Manual module order**: nothing. The server order *is* the arrangement a
 *   user dragged into place, and activity must never rearrange it.
 *
 * Every module surface reads the one cached array this produces, so the rule
 * is applied once per fetch rather than per consumer.
 */

/** Read one project's durable ordering mode, defaulting to automatic. */
export function usesManualModuleOrder(
  projects: readonly Project[],
  projectId: string,
): boolean {
  const project = projects.find((candidate) => candidate.id === projectId);
  return project?.manual_module_order ?? false;
}

/** Order the server's module list the way this project's mode requires. */
export async function applyCanonicalModuleOrder(
  projectId: string,
  serverOrder: Module[],
  manualModuleOrder: boolean,
): Promise<Module[]> {
  if (manualModuleOrder) {
    // Manual order already gives newly created modules their front placement
    // through persisted rank. Retire any local create pins on this read so a
    // future return to automatic mode cannot resurrect stale front placement.
    forgetNewlyCreatedModules(projectId);
    return serverOrder;
  }
  const activity = await fetchModuleActivity(projectId);
  const byRecency = sortModulesByRecency(serverOrder, activity);
  // A module just created here has no activity, so recency alone would file it
  // behind every module that has ever been worked in and undo the front
  // placement the server's fallback order gave it (Decision 4 / Story 17). Lift
  // those modules back to the front; recency owns the arrangement of the rest,
  // and of these too once they earn activity of their own.
  const leading = newlyCreatedModulesAwaitingActivity(projectId, byRecency, activity);
  if (leading.size === 0) return byRecency;
  return [
    ...byRecency.filter((module) => leading.has(module.id)),
    ...byRecency.filter((module) => !leading.has(module.id)),
  ];
}
