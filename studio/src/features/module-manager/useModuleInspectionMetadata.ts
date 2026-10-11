import { skipToken, useQuery } from "@apollo/client/react";
import { useCallback, useEffect } from "react";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { getProjectSelectionGeneration } from "../projects";
import { isAgentlessRun, isLiveAgentRunState, projectRunPresentation, useAgentStatusSelection, type RunRecord } from "../agents/status";
import { ModuleManagerInspectionStoriesDocument, ModuleManagerInspectionStoryFieldsFragmentDoc, ModuleManagerInspectionWorktreesDocument, type ModuleManagerInspectionStoriesQuery, type ModuleManagerInspectionWorktreesQuery } from "./generated/inspectionMetadata.documents";
import { emptyInspectionStatus, useInspectionReadStatus, writeInspectionStatus, type InspectionAvailability } from "./inspectionReadStatus";
import { useModuleManagerStore } from "./state";
import { subscribeInspectionInvalidation } from "./inspectionInvalidation";
import { INSPECTION_PAGE_SIZE, readInspectionCollection } from "./readInspectionCollection";

const inspectionRequests = new Map<string, { generation: number; promise: Promise<void> }>();

export interface InspectionMetric { state: InspectionAvailability; count: number | null }
export interface ModuleInspectionMetadata {
  stories: InspectionMetric; agents: InspectionMetric; worktrees: InspectionMetric;
  activity: { state: InspectionAvailability; at: string | null };
  sprints: { state: InspectionAvailability; memberships: Array<{ id: string | null; name: string }> };
  agentRuns: RunRecord[]; error?: string; retry: () => Promise<void>;
}

export function useModuleInspectionMetadata(projectId: string, moduleId: string): ModuleInspectionMetadata {
  const client = studioApolloClient();
  const project = compactWorktrackerId(projectId); const module = compactWorktrackerId(moduleId);
  const key = `${project}:${module}`;
  const managerGeneration = useModuleManagerStore((state) => state.generation);
  const status = useInspectionReadStatus((state) => state.reads[key] ?? emptyInspectionStatus);
  const variables = { projectId: project, moduleId: module, offset: 0, limit: INSPECTION_PAGE_SIZE };
  const options = project && module ? { client, variables, fetchPolicy: "cache-only" as const } : skipToken;
  const stories = useQuery(ModuleManagerInspectionStoriesDocument, options);
  const trees = useQuery(ModuleManagerInspectionWorktreesDocument, options);
  const holding = useAgentStatusSelection((value) => value);
  const complete = (connection: { nodes: readonly unknown[]; pageInfo: { hasNextPage: boolean }; paginationInfo?: { total: number } | null } | undefined) =>
    !!connection && connection.pageInfo.hasNextPage === false && connection.paginationInfo?.total === connection.nodes.length;
  const loaded = complete(stories.data?.stories) && complete(trees.data?.worktrees);
  const retry = useCallback(async () => {
    if (!project || !module || !useModuleManagerStore.getState().active
      || useModuleManagerStore.getState().generation !== managerGeneration) return;
    const existing = inspectionRequests.get(key);
    if (existing?.generation === managerGeneration) return existing.promise;
    const token = { generation: managerGeneration, promise: Promise.resolve() };
    inspectionRequests.set(key, token);
    const generation = getProjectSelectionGeneration();
    const isCurrent = () => inspectionRequests.get(key) === token && generation === getProjectSelectionGeneration()
      && useModuleManagerStore.getState().active && useModuleManagerStore.getState().generation === managerGeneration;
    token.promise = (async () => {
      writeInspectionStatus(key, { loading: true, error: null, generation: managerGeneration });
      try {
        await Promise.all([
          readInspectionCollection(client, ModuleManagerInspectionStoriesDocument, "stories", variables,
            (node: ModuleManagerInspectionStoriesQuery["stories"]["nodes"][number]) => compactWorktrackerId(node.projectId) === project && compactWorktrackerId(node.parentId ?? "") === module
              && compactWorktrackerId(node.moduleId ?? "") === module && node.type === "task" && node.isArchived === false
              && Number.isInteger(node.stateRevision) && node.stateRevision >= 0, isCurrent,
            (node) => {
              const cached = client.cache.readFragment<Partial<typeof node>>({ id: client.cache.identify(node),
                fragment: ModuleManagerInspectionStoryFieldsFragmentDoc, returnPartialData: true, optimistic: false });
              return cached && typeof cached.stateRevision === "number" && cached.stateRevision > node.stateRevision
                ? { ...node, ...cached } : node;
            }),
          readInspectionCollection(client, ModuleManagerInspectionWorktreesDocument, "worktrees", variables,
            (node: ModuleManagerInspectionWorktreesQuery["worktrees"]["nodes"][number]) => compactWorktrackerId(node.projectId ?? "") === project && compactWorktrackerId(node.moduleId ?? "") === module && ["active", "conflict"].includes(node.status), isCurrent),
        ]);
        if (isCurrent()) writeInspectionStatus(key, { loading: false, error: null, generation: managerGeneration });
      } catch (error) {
        if (isCurrent()) writeInspectionStatus(key, { loading: false, error: error instanceof Error ? error.message : "Module metadata unavailable.", generation: managerGeneration });
      } finally { if (inspectionRequests.get(key) === token) inspectionRequests.delete(key); }
    })();
    return token.promise;
  }, [client, key, managerGeneration]);
  useEffect(() => {
    if (!useModuleManagerStore.getState().active) return;
    if (status.generation !== managerGeneration) { void retry(); return; }
    if (loaded || status.error || status.loading) return;
    // Cache watches can publish after the read-status write. Check the cache
    // directly before scheduling another read, rather than retrying that render lag.
    const cached = client.cache.diff({ query: ModuleManagerInspectionStoriesDocument, variables, returnPartialData: true, optimistic: false }).complete
      && client.cache.diff({ query: ModuleManagerInspectionWorktreesDocument, variables, returnPartialData: true, optimistic: false }).complete;
    if (!cached) void retry();
  }, [key, loaded, status.loading, status.error, status.generation, managerGeneration, retry]);
  useEffect(() => subscribeInspectionInvalidation(project, module, async () => {
    inspectionRequests.delete(key);
    await retry();
    const error = useInspectionReadStatus.getState().reads[key]?.error;
    if (error) throw new Error(error);
  }), [key, retry]);
  const collectionState: InspectionAvailability = status.error ? "unavailable" : status.loading || !loaded ? "loading" : "available";
  const agentState: InspectionAvailability = compactWorktrackerId(holding.projectId ?? "") === project && holding.complete ? "available" : "unknown";
  const agentRuns = agentState === "available" ? Object.values(holding.runs).filter((run) =>
    compactWorktrackerId(run.module_id) === module && !isAgentlessRun(run) && isLiveAgentRunState(projectRunPresentation(run))) : [];
  const roots = collectionState === "available" ? stories.data!.stories.nodes.filter((story) =>
    compactWorktrackerId(story.projectId) === project && compactWorktrackerId(story.parentId ?? "") === module
      && compactWorktrackerId(story.moduleId ?? "") === module && story.type === "task" && !story.isArchived) : [];
  const memberships = new Map<string | null, { id: string | null; name: string }>();
  for (const story of roots) memberships.set(story.sprintId, { id: story.sprintId, name: story.sprint?.id === story.sprintId ? story.sprint.name : (story.sprintId ? "Sprint unavailable" : "Unsprinted") });
  const validTimestamp = (date: string | null | undefined) => !!date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now();
  const activityIncomplete = roots.some((story) => !validTimestamp(story.updatedAt))
    || (trees.data?.worktrees.nodes.some((tree) => !validTimestamp(tree.updatedAt)) ?? false)
    || agentRuns.some((run) => !validTimestamp(run.updated_at));
  const dates = [...roots.map((story) => story.updatedAt), ...(trees.data?.worktrees.nodes.map((tree) => tree.updatedAt) ?? []), ...agentRuns.flatMap((run) => [run.updated_at, run.last_output_at])]
    .filter((date): date is string => !!date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now());
  const activityAt = dates.length ? dates.reduce((latest, date) => Date.parse(date) > Date.parse(latest) ? date : latest) : null;
  const metric = (count: number): InspectionMetric => ({ state: collectionState, count: collectionState === "available" ? count : null });
  return {
    stories: metric(roots.length), worktrees: metric(trees.data?.worktrees.nodes.length ?? 0),
    agents: { state: agentState, count: agentState === "available" ? agentRuns.length : null }, agentRuns,
    activity: { state: collectionState === "available" && (!activityAt || activityIncomplete || agentState !== "available") ? "unknown" : collectionState, at: collectionState === "available" ? activityAt : null },
    sprints: { state: collectionState, memberships: [...memberships.values()] }, error: status.error ?? undefined, retry,
  };
}
