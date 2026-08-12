/**
 * Modules this client has just created, remembered per project until agent
 * activity can position them on its own (#366).
 *
 * Decision 4 puts a new module at the front of the Canonical module order in
 * both ordering modes. A manual project gets that from the rank the create
 * allocates, and an automatic project gets it from the server's
 * newest-created-first fallback — but only until Studio layers agent-activity
 * recency over that fallback, which sorts every module that has *ever* been
 * worked in ahead of the brand-new one that has no activity at all. So the
 * create is recorded here and the canonical order leads with it.
 *
 * A pin is a one-shot: it is retired the moment the module has activity of its
 * own (recency now speaks for it, and its own activity is the newest there is)
 * or the module leaves the project. Pins are per client and per session, like
 * the recency layer they correct.
 */

const pinnedByProject = new Map<string, Set<string>>();
const NO_PINS: ReadonlySet<string> = new Set();

/** Record a module this client just created, so the order leads with it. */
export function markModuleCreated(projectId: string, moduleId: string): void {
  const pinned = pinnedByProject.get(projectId);
  if (pinned) pinned.add(moduleId);
  else pinnedByProject.set(projectId, new Set([moduleId]));
}

/** Drop every pin for a project: it is gone, or its order is no longer ours. */
export function forgetNewlyCreatedModules(projectId: string): void {
  pinnedByProject.delete(projectId);
}

/**
 * Retire the pins this read settles and answer with the ones still owed a front
 * placement: a module that now has activity, or that the project no longer
 * returns, is positioned by the ordinary rules from here on.
 */
export function newlyCreatedModulesAwaitingActivity(
  projectId: string,
  modules: readonly { id: string }[],
  activity: Record<string, string>,
): ReadonlySet<string> {
  const pinned = pinnedByProject.get(projectId);
  if (!pinned) return NO_PINS;
  const present = new Set(modules.map((module) => module.id));
  for (const moduleId of pinned) {
    if (!present.has(moduleId) || activity[moduleId]) pinned.delete(moduleId);
  }
  if (pinned.size === 0) pinnedByProject.delete(projectId);
  return pinned;
}

/** Test seam: forget every remembered create. */
export function resetNewlyCreatedModules(): void {
  pinnedByProject.clear();
}
