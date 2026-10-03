import type { ApolloClient } from "@apollo/client";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { PlanningGraphDocument } from "./generated/planningGraph.documents";

/** Repair project collections once per fact batch, including cached closed views. */
export async function convergePlanningCollections(client: ApolloClient, projectIds: readonly string[]): Promise<void> {
  const projects = new Set(projectIds.map(compactWorktrackerId));
  await client.refetchQueries({
    include: [PlanningGraphDocument],
    updateCache(cache) {
      for (const project of projects) {
        // Planning callers use public IDs; older cached callers may use compact IDs.
        for (const projectId of new Set([project, publicWorktrackerId(project)])) {
          for (const type of ["task", "module"]) {
            cache.evict({
              id: "ROOT_QUERY",
              fieldName: "worktrackerIssue",
              args: {
                filters: { projectId: { eq: projectId }, type: { eq: type }, isArchived: { eq: false } },
                orderBy: type === "task" ? { rank: "ASC" } : { sequenceId: "ASC" },
              },
            });
          }
        }
      }
    },
    onQueryUpdated(query) {
      const projectId: unknown = query.variables.projectId;
      return query.queryName === "PlanningGraph" && typeof projectId === "string"
        && projects.has(compactWorktrackerId(projectId)) ? query.refetch() : false;
    },
  });
}
