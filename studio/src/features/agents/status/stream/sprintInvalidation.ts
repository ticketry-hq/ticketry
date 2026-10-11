import { compactWorktrackerId, publicWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { ROADMAP_ENABLED } from "../../../../shared/config/roadmapAvailability";
import { PlanningGraphDocument, refreshPlanningGraph } from "../../../planning-graph";
import { refreshSprintChoices } from "../../../sprints";

/** Re-read even an inactive graph, and invalidate retained sprint-choice pages. */
export async function refreshSprintHoldings(projectId: string): Promise<void> {
  if (!ROADMAP_ENABLED) return;
  refreshSprintChoices(projectId);
  const client = studioApolloClient();
  const cachedIds = [...new Set([publicWorktrackerId(projectId), compactWorktrackerId(projectId)])]
    .filter((id) => client.readQuery({ query: PlanningGraphDocument, variables: { projectId: id } }));
  await Promise.all(cachedIds.map((id) => refreshPlanningGraph(client, id)));
}

/** One project refresh per fact batch; no sprint records are held outside Apollo. */
export function createSprintInvalidator(windowMs = 50) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const projects = [...pending];
    pending.clear();
    for (const projectId of projects) void refreshSprintHoldings(projectId).catch(() => {});
  };
  return {
    record(projectId: string) {
      pending.add(publicWorktrackerId(projectId));
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
