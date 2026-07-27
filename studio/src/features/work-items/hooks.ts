import { useBacklogStore } from "./internal/backlogStore";

// The work-items query surface: the loaded project's planning data as one
// read-only view model. Hosts and sibling modules read THIS instead of the
// store — the store's shape stays a module-internal concern.
//
// `loadBacklog` rides along as the hydrate verb so a host that lands on a
// stale project can (re)load without reaching for the store.
export function useWorkItems() {
  const projectId = useBacklogStore((s) => s.projectId);
  const items = useBacklogStore((s) => s.items);
  const states = useBacklogStore((s) => s.states);
  const loading = useBacklogStore((s) => s.loading);
  const loadError = useBacklogStore((s) => s.loadError);
  const loadBacklog = useBacklogStore((s) => s.loadBacklog);
  return { projectId, items, states, loading, loadError, loadBacklog };
}
