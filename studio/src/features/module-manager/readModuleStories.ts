import type { ApolloClient } from "@apollo/client";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { ModuleManagerStoriesDocument, ModuleManagerStoryFieldsFragmentDoc,
  type ModuleManagerStoriesQueryVariables, type ModuleManagerStoryFieldsFragment } from "./generated/stories.documents";

export const MODULE_STORY_PAGE_SIZE = 100;
export function moduleStoryVariables(projectId: string, moduleId: string): ModuleManagerStoriesQueryVariables {
  return { projectId: compactWorktrackerId(projectId), moduleId: compactWorktrackerId(moduleId), offset: 0, limit: MODULE_STORY_PAGE_SIZE };
}

/** Commit complete membership atomically; abandoned project/expansion reads never enter the cache. */
export async function readModuleStories(client: ApolloClient, projectId: string, moduleId: string, isCurrent: () => boolean): Promise<void> {
  const variables = moduleStoryVariables(projectId, moduleId);
  const nodes: ModuleManagerStoryFieldsFragment[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let offset = 0;
  while (isCurrent()) {
    const result = await client.query({ query: ModuleManagerStoriesDocument, variables: { ...variables, offset },
      fetchPolicy: "no-cache", context: { queryDeduplication: false } });
    if (!isCurrent()) return;
    const page = result.data?.stories;
    const count = page?.paginationInfo?.total;
    if (!page || !Array.isArray(page.nodes) || page.nodes.length > MODULE_STORY_PAGE_SIZE
      || typeof page.pageInfo?.hasNextPage !== "boolean" || typeof count !== "number" || !Number.isInteger(count) || count < 0
      || (total !== undefined && total !== count)
      || page.nodes.some((story) => compactWorktrackerId(story.project_id) !== variables.projectId
        || !story.parent_id || compactWorktrackerId(story.parent_id) !== variables.moduleId
        || !story.module_id || compactWorktrackerId(story.module_id) !== variables.moduleId || story.is_archived)) {
      throw new Error("Stories are unavailable. Retry to load the complete module.");
    }
    total = count;
    for (const story of page.nodes) {
      const id = compactWorktrackerId(story.id);
      if (seen.has(id)) throw new Error("Stories changed while loading. Retry the module.");
      seen.add(id); nodes.push(story);
    }
    offset += page.nodes.length;
    if (page.pageInfo.hasNextPage) {
      if (!page.nodes.length || offset >= count) throw new Error("Story pagination is incomplete. Retry the module.");
      continue;
    }
    if (nodes.length !== count) throw new Error("Story pagination is incomplete. Retry the module.");
    if (!isCurrent()) return;
    const currentNodes = nodes.map((story) => {
      const cached = client.cache.readFragment<Partial<ModuleManagerStoryFieldsFragment>>({
        id: client.cache.identify({ __typename: story.__typename, id: story.id }), fragment: ModuleManagerStoryFieldsFragmentDoc, returnPartialData: true, optimistic: false });
      return cached && typeof cached.state_revision === "number" && cached.state_revision > story.state_revision
        ? { ...story, ...cached } : story;
    });
    client.writeQuery({ query: ModuleManagerStoriesDocument, variables, data: { stories: { ...page, nodes: currentNodes } } });
    return;
  }
}
