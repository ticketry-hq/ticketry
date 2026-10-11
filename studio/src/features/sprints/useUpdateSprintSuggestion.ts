import { useApolloClient, useMutation } from "@apollo/client/react";
import { useCallback, useState } from "react";
import { PlanningGraphDocument, refreshPlanningGraph } from "../planning-graph";
import type { ResultOf } from "@graphql-typed-document-node/core";
import { completeSuggestionRead } from "./suggestionReadCompleteness";
import { readSuggestionReadiness, suggestionReadScope } from "./suggestionReadiness";
import { isSuggestionWriteRejection } from "./suggestionWriteRejection";
import { SprintSuggestionsDocument, SprintSuggestionExecutionDocument, UpdateSprintSuggestionDocument, type SprintSuggestionRecordFragment, type UpdateSprintSuggestionMutationVariables } from "./generated/sprints.documents";

export type SuggestionWriteOutcome =
  | { kind: "saved"; suggestion: SprintSuggestionRecordFragment; refreshFailed: boolean }
  | { kind: "rejected"; suggestion?: SprintSuggestionRecordFragment }
  | { kind: "unconfirmed" };

/** A committed decision remains successful even when its dependent reads fail. */
export function useUpdateSprintSuggestion(scope: { projectId: string; sprintId: string }) {
  const client = useApolloClient();
  const [mutate] = useMutation(UpdateSprintSuggestionDocument);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (confirmReady = true) => {
    const reads = suggestionReadScope(scope.projectId, scope.sprintId);
    const revision = reads.revision();
    const current = () => reads.revision() === revision;
    const snapshot: { graph: ResultOf<typeof PlanningGraphDocument> | null } = { graph: null };
    const results = await Promise.allSettled([
      refreshPlanningGraph(client, scope.projectId, { onRead: (graph) => { snapshot.graph = graph; },
        shouldApply: () => current() && completeSuggestionRead(PlanningGraphDocument, snapshot.graph) }),
      client.query({ query: SprintSuggestionsDocument, variables: { sprintId: scope.sprintId }, fetchPolicy: "no-cache", context: { queryDeduplication: false } }),
      client.query({ query: SprintSuggestionExecutionDocument, variables: { sprintId: scope.sprintId }, fetchPolicy: "no-cache", context: { queryDeduplication: false } }),
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    const suggestions = results[1];
    const execution = results[2];
    const graph = snapshot.graph;
    if (!current() || !completeSuggestionRead(PlanningGraphDocument, graph) ||
        suggestions.status !== "fulfilled" || !suggestions.value.data || !completeSuggestionRead(SprintSuggestionsDocument, suggestions.value.data) ||
        execution.status !== "fulfilled" || !execution.value.data || !completeSuggestionRead(SprintSuggestionExecutionDocument, execution.value.data)) throw new Error("The server returned incomplete or superseded suggestion reads.");
    if (graph?.project.nodes[0]?.id !== scope.projectId || !graph.sprints.nodes.some((row) => row.id === scope.sprintId)) throw new Error("The owning planning graph is incomplete.");
    client.cache.batch({ update: (cache) => {
      cache.writeQuery({ query: SprintSuggestionsDocument, variables: { sprintId: scope.sprintId }, data: suggestions.value.data });
      cache.writeQuery({ query: SprintSuggestionExecutionDocument, variables: { sprintId: scope.sprintId }, data: execution.value.data });
    } });
    if (confirmReady) reads.refreshed(revision);
    return { suggestions: suggestions.value.data.worktrackerSprintSuggestion.nodes, graph };
  }, [client, scope.projectId, scope.sprintId]);
  const inspect = useCallback(async (variables: UpdateSprintSuggestionMutationVariables): Promise<SuggestionWriteOutcome> => {
    try {
      const reads = suggestionReadScope(scope.projectId, scope.sprintId);
      const revision = reads.revision();
      const { suggestions, graph } = await refresh(false);
      const suggestion = suggestions.find((row) => row.id === variables.id && row.sprintId === scope.sprintId);
      if (!suggestion) return { kind: "unconfirmed" };
      const story = graph?.workItems.nodes.find((row) => row.id === suggestion.issueId);
      if (Boolean(suggestion.issueId) !== Boolean(suggestion.issue)) return { kind: "unconfirmed" };
      if (suggestion.issueId && (!story || story.issueType?.name !== "Story" || suggestion.issue?.id !== story.id || suggestion.issue.sprintId !== story.sprintId)) return { kind: "unconfirmed" };
      const membershipConfirmed = variables.status === "dismissed" ||
        (variables.status === "accepted" ? Boolean(story && story.sprintId === scope.sprintId && suggestion.issue?.id === story.id) : !suggestion.issueId || Boolean(story && story.sprintId === null));
      if (suggestion.status === variables.status && membershipConfirmed) { reads.refreshed(revision); return { kind: "saved", suggestion, refreshFailed: false }; }
      // The authoritative unchanged row permits an explicit repeat decision, never an automatic write.
      if (variables.status !== "waiting" && suggestion.status === "waiting" && (!story || story.sprintId === null)) { reads.refreshed(revision); return { kind: "rejected", suggestion }; }
      if (variables.status === "waiting" && (suggestion.status === "dismissed" || (suggestion.status === "accepted" && story?.sprintId === scope.sprintId))) { reads.refreshed(revision); return { kind: "rejected", suggestion }; }
      return { kind: "unconfirmed" };
    } catch { return { kind: "unconfirmed" }; }
  }, [client, refresh, scope.projectId, scope.sprintId]);
  const update = useCallback(async (variables: UpdateSprintSuggestionMutationVariables): Promise<SuggestionWriteOutcome> => {
    setBusy(true);
    const reads = suggestionReadScope(scope.projectId, scope.sprintId);
    const previouslyRequired = readSuggestionReadiness(scope.projectId, scope.sprintId).needsRead;
    const revision = reads.begin();
    let readRequired = true;
    try {
      let suggestion: SprintSuggestionRecordFragment | null | undefined;
      try { suggestion = (await mutate({ variables })).data?.update_sprint_suggestion; }
      catch (error) {
        if (isSuggestionWriteRejection(error)) { readRequired = previouslyRequired; return { kind: "rejected" }; }
        const outcome = await inspect(variables);
        readRequired = outcome.kind === "unconfirmed";
        return outcome;
      }
      if (!suggestion) { const outcome = await inspect(variables); readRequired = outcome.kind === "unconfirmed"; return outcome; }
      try { await refresh(); readRequired = false; return { kind: "saved", suggestion, refreshFailed: false }; }
      catch { return { kind: "saved", suggestion, refreshFailed: true }; }
    } finally { reads.finish(revision, readRequired); setBusy(false); }
  }, [mutate, refresh, inspect, scope.projectId, scope.sprintId]);
  return { update, refresh, inspect, busy };
}
