import { skipToken, useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useRef } from "react";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import type { Module } from "../../shared/api/types";
import { studioApolloClient } from "../../shared/apollo/client";
import { getProjectSelectionGeneration } from "../projects";
import { refreshArchivedDependencies } from "./refreshArchivedDependencies";
import { subscribeInspectionInvalidation } from "./inspectionInvalidation";
import { emptyArchivedMetadata, useArchivedReadMetadata, writeArchivedReadMetadata } from "./archivedReadMetadata";
import { ModuleManagerArchivedModulesDocument } from "./generated/archivedModules.documents";
import { archivedModuleVariables, readArchivedModules } from "./readArchivedModules";

const EMPTY_MODULES: Module[] = [];

/** Archive membership has its own collection; it never expands ordinary project-open tab membership. */
export function useArchivedModules(projectId: string | null) {
  const scope = projectId ? compactWorktrackerId(projectId) : null;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef<object | null>(null);
  const metadata = useArchivedReadMetadata((state) => scope ? state.projects[scope] ?? emptyArchivedMetadata : emptyArchivedMetadata);
  const client = studioApolloClient();
  const query = useQuery(ModuleManagerArchivedModulesDocument, scope ? {
    client, variables: archivedModuleVariables(scope), fetchPolicy: "cache-only",
  } : skipToken);

  const retry = useCallback(async () => {
    if (!scope || request.current) return;
    const token = {};
    const generation = getProjectSelectionGeneration();
    request.current = token;
    const isCurrent = () => currentScope.current === scope && request.current === token
      && getProjectSelectionGeneration() === generation;
    writeArchivedReadMetadata(scope, { loading: true, error: null });
    try {
      const affected = useArchivedReadMetadata.getState().projects[scope]?.refreshModuleIds;
      if (affected?.length) await refreshArchivedDependencies(scope, affected);
      await readArchivedModules(client, scope, isCurrent);
      if (isCurrent()) writeArchivedReadMetadata(scope, { loading: false, refreshModuleIds: [] });
    } catch (error) {
      if (isCurrent()) writeArchivedReadMetadata(scope, { loading: false,
        error: error instanceof Error ? error.message : "Could not load archived modules." });
    } finally {
      if (request.current === token) request.current = null;
    }
  }, [client, scope]);

  useEffect(() => {
    void retry();
    return () => {
      request.current = null;
      if (scope) writeArchivedReadMetadata(scope, { loading: false });
    };
  }, [retry, scope]);

  useEffect(() => scope ? subscribeInspectionInvalidation(scope, "", async () => {
    request.current = null;
    await retry();
    const error = useArchivedReadMetadata.getState().projects[scope]?.error;
    if (error) throw new Error(error);
  }, "archive") : undefined, [scope, retry]);

  const archive = scope ? query.data?.modules : undefined;
  const loaded = !!archive && !archive.pageInfo.hasNextPage && archive.paginationInfo?.total === archive.nodes.length;
  const loading = !!scope && (metadata.loading || (!loaded && !metadata.error));
  const modules: Module[] = scope && archive ? archive.nodes.filter((module) => module.is_archived
    && compactWorktrackerId(module.project_id) === scope).map((module) => ({
      id: publicWorktrackerId(module.id), name: module.name,
      project_id: publicWorktrackerId(module.project_id), sequence_id: module.sequence_id,
      key: `${module.project?.slug ?? ""}-${module.sequence_id}`, is_archived: true,
      issue_type: publicWorktrackerId(module.issue_type),
    })) : EMPTY_MODULES;
  return { modules, loading, complete: !!scope && loaded && !loading && !metadata.error,
    error: metadata.error ? new Error(metadata.error) : undefined, retry };
}
