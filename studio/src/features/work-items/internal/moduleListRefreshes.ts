import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { refreshRead, type RefreshRead } from "../../../shared/apollo/declaredMutation";
import { WorkTrackerModuleOpenDocument } from "../generated/workItems.documents";

/** The exact module-list reads a work-item write makes stale. */
export function moduleListRefreshes(
  moduleIds: readonly (string | null | undefined)[],
): RefreshRead[] {
  return moduleIds
    .filter((id): id is string => Boolean(id))
    .map((id) => refreshRead(WorkTrackerModuleOpenDocument, { moduleId: compactWorktrackerId(id) }));
}
