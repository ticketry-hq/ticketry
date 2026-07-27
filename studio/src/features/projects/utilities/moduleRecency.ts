// Shared module-recency ordering (#831 / #598).
//
// Two pieces live here so Studio work-item surfaces order modules identically
// and cannot drift:
//
//   1. `sortModulesByRecency` — the pure sort. Merge a `{module_id: isoTs}`
//      activity map onto modules and order most-recent-first; modules without a
//      timestamp keep their relative input order at the tail.
//   2. A module-recency *provider* seam. The recency signal is agent-run
//      activity behind `/api/runs/module-activity`. The runtime registers the
//      concrete runs-backed provider. With no provider registered (or
//      on any failure) the activity map is empty, so the module order is left
//      exactly as the API returned it — no regression for generic.

/** A source of per-module last-activity timestamps for a project. */
export type ModuleRecencyProvider = (
  projectId: string,
) => Promise<Record<string, string>>;

// Default no-op: no activity, so the API module order is preserved. Overwritten
// by the agent runtime via `registerModuleRecencyProvider`.
let provider: ModuleRecencyProvider = async () => ({});

/** Register the concrete recency provider. */
export function registerModuleRecencyProvider(next: ModuleRecencyProvider): void {
  provider = next;
}

/**
 * Fetch the per-module activity map for a project through the registered
 * provider. Never throws: an absent provider returns `{}`, and a provider
 * failure is swallowed to `{}`, so callers always get a well-formed map and
 * fall back to the API order.
 */
export async function fetchModuleActivity(
  projectId: string,
): Promise<Record<string, string>> {
  try {
    return await provider(projectId);
  } catch {
    return {};
  }
}

/**
 * Merge the activity map onto each module and order by most-recent interaction,
 * newest first (#598). Modules with a timestamp lead, sorted descending;
 * modules without one keep their relative input order and follow. Relies on
 * Array.prototype.sort being stable (ES2019+) so ties — and the untouched
 * tail — preserve their original API order.
 */
export function sortModulesByRecency<T extends { id: string; last_activity?: string }>(
  modules: T[],
  activity: Record<string, string>,
): T[] {
  const merged = modules.map((m) => {
    const last = activity[m.id];
    return last ? { ...m, last_activity: last } : m;
  });
  return merged
    .map((module, index) => ({ module, index }))
    .sort((a, b) => {
      const ta = a.module.last_activity;
      const tb = b.module.last_activity;
      if (ta && tb) return ta < tb ? 1 : ta > tb ? -1 : a.index - b.index;
      if (ta) return -1;
      if (tb) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.module);
}
