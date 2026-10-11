import { useQuery } from "@apollo/client/react";
import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { StoryActiveSprintDocument, StorySelectedSprintDocument,
  type SprintChoiceFieldsFragment } from "../generated/storySprintChoices.documents";

type ReadPolicy = "cache-and-network" | "cache-only";

function resolveSprintRead(nodes: readonly SprintChoiceFieldsFragment[] | undefined, projectId: string | null, sprintId?: string) {
  nodes = Array.isArray(nodes) ? nodes : undefined;
  const valid = nodes?.filter((sprint) =>
    compactWorktrackerId(sprint.projectId) === compactWorktrackerId(projectId ?? ""));
  const invalid = nodes?.some((sprint) =>
    compactWorktrackerId(sprint.projectId) !== compactWorktrackerId(projectId ?? "")
    || (sprintId !== undefined && compactWorktrackerId(sprint.id) !== compactWorktrackerId(sprintId)));
  const ambiguous = valid && valid.length > 1;
  const sprint = ambiguous || invalid ? undefined : valid?.[0];
  return {
    ready: !!projectId && nodes !== undefined && !ambiguous && !invalid,
    sprint: sprint ? { ...sprint, id: publicWorktrackerId(sprint.id), projectId: publicWorktrackerId(sprint.projectId) } : null,
    error: ambiguous ? new Error("The project has more than one active sprint.")
      : invalid ? new Error("Sprint read does not match the selected project and sprint.") : undefined,
  };
}

export function useActiveStorySprint(projectId: string | null, fetchPolicy: ReadPolicy = "cache-and-network") {
  const query = useQuery(StoryActiveSprintDocument, projectId ? {
    client: studioApolloClient(), variables: { projectId: compactWorktrackerId(projectId) },
    fetchPolicy, nextFetchPolicy: fetchPolicy === "cache-only" ? "cache-only" : "cache-first",
    notifyOnNetworkStatusChange: true,
  } : { client: studioApolloClient(), skip: true, variables: { projectId: "" } });
  const result = resolveSprintRead(query.data?.sprints?.nodes, projectId);
  const malformed = query.data !== undefined && !Array.isArray(query.data.sprints?.nodes);
  return { ...result, loading: query.loading, error: result.error ?? query.error ?? (malformed ? new Error("Sprint read is incomplete.") : undefined),
    retry: query.refetch, refetch: query.refetch };
}

export function useSelectedStorySprint(projectId: string | null, sprintId: string | null, fetchPolicy: ReadPolicy = "cache-and-network") {
  const query = useQuery(StorySelectedSprintDocument, projectId && sprintId ? {
    client: studioApolloClient(), variables: {
      projectId: compactWorktrackerId(projectId), sprintId: compactWorktrackerId(sprintId),
    }, fetchPolicy, nextFetchPolicy: fetchPolicy === "cache-only" ? "cache-only" : "cache-first",
    notifyOnNetworkStatusChange: true,
  } : { client: studioApolloClient(), skip: true, variables: { projectId: "", sprintId: "" } });
  const result = resolveSprintRead(sprintId ? query.data?.sprints?.nodes : undefined, projectId, sprintId ?? undefined);
  const malformed = !!sprintId && query.data !== undefined && !Array.isArray(query.data.sprints?.nodes);
  // Cached absence cannot clear explicit intent while its scoped lookup is pending.
  const ready = result.ready && (!query.loading || !!result.sprint || fetchPolicy === "cache-only");
  return { ...result, ready, loading: query.loading, error: result.error ?? query.error ?? (malformed ? new Error("Sprint read is incomplete.") : undefined),
    retry: query.refetch, refetch: query.refetch };
}

/** Synchronous reads for navigation; the project controller owns network requests. */
export function getStorySprintReadsSnapshot(projectId: string | null, sprintId: string | null = null) {
  const client = studioApolloClient();
  const active = projectId ? client.readQuery({ query: StoryActiveSprintDocument,
    variables: { projectId: compactWorktrackerId(projectId) }, optimistic: true }) : null;
  const selected = projectId && sprintId ? client.readQuery({ query: StorySelectedSprintDocument,
    variables: { projectId: compactWorktrackerId(projectId), sprintId: compactWorktrackerId(sprintId) }, optimistic: true }) : null;
  return {
    active: { ...resolveSprintRead(active?.sprints.nodes, projectId), loading: false },
    selected: { ...resolveSprintRead(selected?.sprints.nodes, projectId, sprintId ?? undefined), loading: false },
  };
}
