import { useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useRef } from "react";
import { studioApolloClient } from "../../shared/apollo/client";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { getProjectSelectionGeneration } from "../projects";
import { orderedWorkItems } from "../work-items";
import { ModuleManagerStoriesDocument } from "./generated/stories.documents";
import { moduleStoryVariables, readModuleStories } from "./readModuleStories";
import { emptyModuleStoryRead, moduleStoryScope, useModuleStoryReadMetadata, writeModuleStoryRead } from "./storyReadMetadata";
import { subscribeInspectionInvalidation } from "./inspectionInvalidation";

export function useExpandedModuleStories(projectId: string, moduleId: string) {
  const client = studioApolloClient();
  const scope = moduleStoryScope(projectId, moduleId);
  const current = useRef(scope); current.current = scope;
  const request = useRef<object | null>(null);
  const metadata = useModuleStoryReadMetadata((state) => state.scopes[scope] ?? emptyModuleStoryRead);
  const query = useQuery(ModuleManagerStoriesDocument, { client, variables: moduleStoryVariables(projectId, moduleId), fetchPolicy: "cache-only" });
  const retry = useCallback(async (propagateFailure = false) => {
    if (request.current) return;
    const token = {}; const generation = getProjectSelectionGeneration(); request.current = token;
    const isCurrent = () => current.current === scope && request.current === token && generation === getProjectSelectionGeneration();
    writeModuleStoryRead(scope, { loading: true, error: null });
    try {
      await readModuleStories(client, projectId, moduleId, isCurrent);
      if (isCurrent()) writeModuleStoryRead(scope, { loading: false });
    } catch (error) {
      if (isCurrent()) {
        writeModuleStoryRead(scope, { loading: false, error: error instanceof Error ? error.message : "Could not load stories." });
        if (propagateFailure) throw error;
      }
    } finally { if (request.current === token) request.current = null; }
  }, [client, projectId, moduleId, scope]);
  useEffect(() => {
    void retry();
    return () => { request.current = null; writeModuleStoryRead(scope, { loading: false }); };
  }, [retry, scope]);
  useEffect(() => subscribeInspectionInvalidation(projectId, moduleId, async () => {
    // A newer membership fact supersedes an unfinished snapshot rather than
    // dropping that refresh behind the ordinary retry's in-flight guard.
    request.current = null;
    await retry(true);
  }, "stories"), [projectId, moduleId, retry]);
  const collection = query.data?.stories;
  const complete = !!collection && !collection.pageInfo.hasNextPage && collection.paginationInfo?.total === collection.nodes.length;
  const loading = metadata.loading || (!complete && !metadata.error);
  const stories = complete ? orderedWorkItems(collection.nodes).filter((story) => !story.is_archived
    && compactWorktrackerId(story.project_id) === compactWorktrackerId(projectId)
    && !!story.parent_id && compactWorktrackerId(story.parent_id) === compactWorktrackerId(moduleId)) : [];
  return { stories, complete, loading, error: metadata.error, retry };
}
