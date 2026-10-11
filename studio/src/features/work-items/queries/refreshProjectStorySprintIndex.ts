import type { ApolloClient, ObservableQuery } from "@apollo/client";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { ProjectStorySprintModulesDocument } from "../generated/storySprintIndex.documents";

type IndexArguments = { filters?: { projectId?: { eq?: string }; type?: { eq?: string };
  isArchived?: { eq?: boolean }; parentId?: { is_in?: string[] } }; orderBy?: { id?: string } };

// Request coordination only: server records and collections remain in Apollo.
const refreshes = new WeakMap<ApolloClient, Map<string, Promise<void>>>();

/** Refresh mounted project readers, invalidating only closed memberships in this project. */
export async function refreshProjectStorySprintIndex(projectId: string, client: ApolloClient = studioApolloClient()): Promise<void> {
  if (!ROADMAP_ENABLED) return;
  const project = compactWorktrackerId(projectId);
  let projects = refreshes.get(client);
  if (!projects) { projects = new Map(); refreshes.set(client, projects); }
  const previous = projects.get(project);
  const next = (previous ?? Promise.resolve()).catch(() => {}).then(() => refreshProject(project, client));
  projects.set(project, next);
  try { await next; } finally { if (projects.get(project) === next) projects.delete(project); }
}

function isCurrentOwner(query: ObservableQuery, project: string, client: ApolloClient) {
  return query.options.fetchPolicy !== "cache-only" && [...client.getObservableQueries("active").values()].includes(query)
    && typeof query.variables.projectId === "string" && compactWorktrackerId(query.variables.projectId) === project;
}

async function refreshOwner(query: ObservableQuery, project: string, client: ApolloClient, variables?: { moduleIds: string[] }) {
  if (!isCurrentOwner(query, project, client)) return;
  const pendingRead = query.getCurrentResult().loading;
  await query.refetch(variables);
  // Apollo may deduplicate this refetch against a read started before the fact.
  // Once that read settles, start one fresh read for this requested refresh.
  if (pendingRead && isCurrentOwner(query, project, client)) await query.refetch(variables);
}

async function refreshProject(project: string, client: ApolloClient): Promise<void> {
  const queries = [...client.getObservableQueries("active").values()].filter((query) =>
    ["ProjectStorySprintModules", "ProjectStorySprintIndex"].includes(query.queryName ?? "")
    && typeof query.variables.projectId === "string" && compactWorktrackerId(query.variables.projectId) === project);
  const moduleQueries = queries.filter((query) => query.queryName === "ProjectStorySprintModules");
  const rootQueries = queries.filter((query) => query.queryName === "ProjectStorySprintIndex");
  client.cache.batch({ update(cache) {
    for (const key of Object.keys((cache.extract() as Record<string, object>).ROOT_QUERY ?? {})) {
      if (!key.startsWith("worktrackerIssue(")) continue;
      const args = JSON.parse(key.slice("worktrackerIssue(".length, -1)) as IndexArguments;
      const filter = args.filters;
      if (!filter?.projectId?.eq || compactWorktrackerId(filter.projectId.eq) !== project
        || filter.isArchived?.eq !== false || args.orderBy?.id !== "ASC"
        || Object.keys(args).length !== 2 || Object.keys(args.orderBy).length !== 1) continue;
      const isModules = filter.type?.eq === "module" && Object.keys(filter).length === 3;
      const isRoots = filter.type?.eq === "task" && Object.keys(filter).length === 4 && Array.isArray(filter.parentId?.is_in);
      if (!isModules && !isRoots) continue;
      const mounted = isModules ? moduleQueries.length > 0 : rootQueries.some((query) =>
        JSON.stringify(query.variables.moduleIds) === JSON.stringify(filter.parentId!.is_in));
      if (!mounted) cache.evict({ id: "ROOT_QUERY", fieldName: "worktrackerIssue", args });
    }
  } });
  await Promise.all(moduleQueries.map((query) => refreshOwner(query, project, client)));
  const modules = client.readQuery({ query: ProjectStorySprintModulesDocument, variables: { projectId: project }, optimistic: false });
  if (!modules || modules.modules.pageInfo.hasNextPage
    || (modules.modules.paginationInfo && modules.modules.paginationInfo.total !== modules.modules.nodes.length)) return;
  const moduleIds = modules.modules.nodes.map((module) => compactWorktrackerId(module.id));
  if (moduleIds.length) await Promise.all([...client.getObservableQueries("active").values()]
    .filter((query) => query.queryName === "ProjectStorySprintIndex" && isCurrentOwner(query, project, client))
    .map((query) => refreshOwner(query, project, client, { moduleIds })));
}
