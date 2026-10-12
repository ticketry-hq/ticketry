import type { ApolloClient } from "@apollo/client";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { loadModules } from "../projects";
import { PlanningGraphDocument } from "./generated/planningGraph.documents";

/** Repair project collections once per fact batch, including cached closed views. */
export async function convergePlanningCollections(client: ApolloClient, projectIds: readonly string[]): Promise<void> {
  const projects = new Set(projectIds.map(compactWorktrackerId));
  // The compact module list is also the project-open read the workspace renders
  // from. Evicting a displayed one would leave module tabs, sprint selection and
  // the Stories pane reading "no modules" until a reader refetched, remounting
  // the workspace and discarding a draft typed meanwhile (CODING-2868), so a
  // displayed list is re-read in place instead.
  const displayed = displayedProjectOpens(client, projects);
  await Promise.all([
    client.refetchQueries({
      include: [PlanningGraphDocument],
      updateCache(cache) {
        for (const project of projects) {
          // Planning callers use public IDs; older cached callers may use compact IDs.
          for (const projectId of new Set([project, publicWorktrackerId(project)])) {
            for (const type of ["task", "module"]) {
              if (type === "module" && displayed.has(projectId)) continue;
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
    }),
    ...[...displayed].map((projectId) => loadModules(projectId, { queryDeduplication: false })),
  ]);
}

function displayedProjectOpens(client: ApolloClient, projects: ReadonlySet<string>): Set<string> {
  const displayed = new Set<string>();
  for (const query of client.getObservableQueries("active")) {
    const projectId: unknown = query.variables.projectId;
    if (query.queryName === "WorkTrackerProjectOpen" && typeof projectId === "string" && projects.has(projectId)) displayed.add(projectId);
  }
  return displayed;
}
