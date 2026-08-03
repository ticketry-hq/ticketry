import { useBacklogStore } from "./internal/backlogStore";
import { useIssueStore } from "./issueStore";
import { useCachedStates } from "../../shared/query/stateCatalog";

// The work-items query surface: the loaded project's planning data as one
// read-only view model. Hosts and sibling modules read THIS instead of the
// store — the store's shape stays a module-internal concern.
//
// `loadBacklog` rides along as the hydrate verb so a host that lands on a
// stale project can (re)load without reaching for the store.
export function useWorkItems() {
  const projectId = useBacklogStore((s) => s.projectId);
  const itemIds = useBacklogStore((s) => s.itemIds);
  const workItemsById = useIssueStore((s) => s.workItemsById);
  const items = itemIds
    .map((id) => workItemsById[id])
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  // The catalog is query-cached, so subscribe to it there: a rename or reorder
  // notifies query subscribers, not the backlog store's. loadBacklog owns the
  // fetch, so this only reads along.
  const states = useCachedStates(projectId);
  const loading = useBacklogStore((s) => s.loading);
  const loadError = useBacklogStore((s) => s.loadError);
  const loadBacklog = useBacklogStore((s) => s.loadBacklog);
  return { projectId, items, states, loading, loadError, loadBacklog };
}
