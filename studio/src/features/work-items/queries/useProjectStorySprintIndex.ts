import { useCallback } from "react";
import { ROADMAP_ENABLED } from "../../../shared/config/roadmapAvailability";
import { refreshProjectStorySprintIndex } from "./refreshProjectStorySprintIndex";
import { useQuery } from "@apollo/client/react";
import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { ProjectStorySprintIndexDocument, ProjectStorySprintModulesDocument,
  type ProjectStorySprintIndexQuery } from "../generated/storySprintIndex.documents";

type ReadPolicy = "cache-and-network" | "cache-only";
type Root = ProjectStorySprintIndexQuery["roots"]["nodes"][number];
type Connection = { nodes: readonly unknown[]; pageInfo: { hasNextPage: boolean };
  paginationInfo?: { total: number } | null };
const NO_ROOTS: Root[] = [];

function isComplete(connection: Connection | undefined): boolean {
  return !!connection && Array.isArray(connection.nodes) && connection.pageInfo?.hasNextPage === false
    && (!connection.paginationInfo || connection.paginationInfo.total === connection.nodes.length);
}

function projectRoots(projectId: string, moduleIds: readonly string[], data: ProjectStorySprintIndexQuery | null | undefined) {
  if (!data || !isComplete(data.roots)) return { roots: NO_ROOTS, complete: false };
  const modules = new Set(moduleIds.map(compactWorktrackerId));
  const roots = data.roots.nodes.filter((root) => !root.is_archived
    && compactWorktrackerId(root.project_id) === compactWorktrackerId(projectId)
    && !!root.parent_id && modules.has(compactWorktrackerId(root.parent_id))
    && !!root.module_id && compactWorktrackerId(root.parent_id) === compactWorktrackerId(root.module_id)).map((root) => ({
      ...root, id: publicWorktrackerId(root.id), project_id: publicWorktrackerId(root.project_id),
      parent_id: root.parent_id ? publicWorktrackerId(root.parent_id) : null,
      module_id: root.module_id ? publicWorktrackerId(root.module_id) : null,
      sprint_id: root.sprint_id ? publicWorktrackerId(root.sprint_id) : null,
    }));
  return { roots, complete: true };
}

export function getProjectStorySprintIndexSnapshot(projectId: string | null) {
  if (!ROADMAP_ENABLED || !projectId) return { roots: NO_ROOTS, complete: false };
  const client = studioApolloClient();
  const scope = { projectId: compactWorktrackerId(projectId) };
  const modules = client.readQuery({ query: ProjectStorySprintModulesDocument, variables: scope, optimistic: true });
  if (!isComplete(modules?.modules)) return { roots: NO_ROOTS, complete: false };
  const moduleIds = modules!.modules.nodes.map((module) => compactWorktrackerId(module.id));
  if (!moduleIds.length) return { roots: NO_ROOTS, complete: true };
  return projectRoots(projectId, moduleIds, client.readQuery({ query: ProjectStorySprintIndexDocument,
    variables: { ...scope, moduleIds }, optimistic: true }));
}

export function useProjectStorySprintIndex(projectId: string | null, fetchPolicy: ReadPolicy = "cache-and-network") {
  const scopeId = ROADMAP_ENABLED ? projectId : null;
  const options = { client: studioApolloClient(), fetchPolicy,
    nextFetchPolicy: fetchPolicy === "cache-only" ? "cache-only" as const : "cache-first" as const,
    notifyOnNetworkStatusChange: true };
  const modules = useQuery(ProjectStorySprintModulesDocument, scopeId ? {
    ...options, variables: { projectId: compactWorktrackerId(scopeId) },
  } : { client: studioApolloClient(), skip: true, variables: { projectId: "" } });
  const modulesComplete = !!scopeId && isComplete(modules.data?.modules);
  const moduleIds = modulesComplete ? modules.data!.modules.nodes.map((module) => compactWorktrackerId(module.id)) : [];
  const query = useQuery(ProjectStorySprintIndexDocument, scopeId && modulesComplete && moduleIds.length ? {
    ...options, variables: { projectId: compactWorktrackerId(scopeId), moduleIds },
  } : { client: studioApolloClient(), skip: true, variables: { projectId: "", moduleIds: [] } });
  const result = !scopeId || !modulesComplete ? { roots: NO_ROOTS, complete: false }
    : !moduleIds.length ? { roots: NO_ROOTS, complete: true }
    : projectRoots(scopeId, moduleIds, query.data);
  const incomplete = (modules.data && !modulesComplete) || (query.data && !result.complete);
  const error = modules.error ?? query.error ?? (incomplete ? new Error("Story sprint membership read is incomplete.") : undefined);
  const refetch = useCallback(async () => {
    if (scopeId) await refreshProjectStorySprintIndex(scopeId);
  }, [scopeId]);
  return { ...result, loading: modules.loading || (moduleIds.length > 0 && query.loading), error, retry: refetch, refetch };
}
