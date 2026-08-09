import { fetchModuleActivity, sortModulesByRecency } from "./moduleRecency";
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
 *   server order. An activity lookup failure is already swallowed by
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
  if (manualModuleOrder) return serverOrder;
  return sortModulesByRecency(serverOrder, await fetchModuleActivity(projectId));
}
