import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { loadModules } from "../projects";
import { refreshProjectStorySprintIndex, WorkTrackerModuleOpenDocument } from "../work-items";
import { invalidateModuleInspections } from "./inspectionInvalidation";

/** Retry all affected collection reads without repeating the committed record write. */
export async function refreshArchivedDependencies(projectId: string, moduleIds: readonly string[]): Promise<void> {
  const client = studioApolloClient();
  const results = await Promise.allSettled([
    loadModules(projectId, { queryDeduplication: false }), refreshProjectStorySprintIndex(projectId),
    ...moduleIds.map((moduleId) => client.query({ query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: compactWorktrackerId(moduleId) }, fetchPolicy: "network-only", context: { queryDeduplication: false } })),
    invalidateModuleInspections([projectId], moduleIds),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
