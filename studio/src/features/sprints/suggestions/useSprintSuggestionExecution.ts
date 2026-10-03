import { useCallback, useEffect, useRef, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client/react";
import { SprintSuggestionExecutionDocument, SprintSuggestionExecutionRunDocument } from "../generated/sprints.documents";
import { deriveAgentState } from "./agentState";

const messageOf = (error: unknown) => error instanceof Error ? error.message : "Could not refresh sprint suggestions.";

export function useSprintSuggestionExecution(sprintId: string) {
  const client = useApolloClient();
  const sprintQuery = useQuery(SprintSuggestionExecutionDocument, { variables: { sprintId } });
  const sprint = (sprintQuery.data ?? sprintQuery.previousData)?.worktrackerSprint.nodes.find((row) => row.id === sprintId);
  const runQuery = useQuery(SprintSuggestionExecutionRunDocument, {
    variables: { agentRunId: sprint?.suggestionRunId ?? "" }, skip: !sprint?.suggestionRunId,
  });
  const execution = (runQuery.data ?? runQuery.previousData)?.agentExecutions.nodes.find((row) => row.agentRunId === sprint?.suggestionRunId);
  const state = deriveAgentState(execution, sprint?.goalsRevisedAt, sprint?.suggestions.nodes.length ?? 0);
  const running = state.kind === "running";
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(false);
  const { startPolling: startSprintPolling, stopPolling: stopSprintPolling, refetch: refetchSprint } = sprintQuery;
  const { startPolling: startRunPolling, stopPolling: stopRunPolling, refetch: refetchRun } = runQuery;

  useEffect(() => {
    if (running) { startSprintPolling(1000); startRunPolling(1000); }
    return () => { stopSprintPolling(); stopRunPolling(); };
  }, [running, startSprintPolling, stopSprintPolling, startRunPolling, stopRunPolling]);

  useEffect(() => {
    setRefreshError(null);
    if (execution?.state !== "succeeded") return;
    let current = true;
    void client.refetchQueries({ include: ["SprintSuggestionExecution", "SprintSuggestions", "PlanningGraph"] })
      .catch((error: unknown) => { if (current) setRefreshError(messageOf(error)); });
    return () => { current = false; };
  }, [client, execution?.id, execution?.state]);

  const retryStatus = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    setRefreshError(null);
    void (async () => {
      const result = await refetchSprint();
      const runId = result.data?.worktrackerSprint.nodes.find((row) => row.id === sprintId)?.suggestionRunId;
      if (runId) await refetchRun({ agentRunId: runId });
      await client.refetchQueries({ include: ["SprintSuggestions", "PlanningGraph"] });
    })().catch((error: unknown) => setRefreshError(messageOf(error))).finally(() => {
      pending.current = false;
      setRefreshing(false);
    });
  }, [client, refetchSprint, refetchRun, sprintId]);

  const missingRun = !!sprint?.suggestionRunId && !execution && !runQuery.loading;
  const error = sprintQuery.error?.message ?? runQuery.error?.message ?? refreshError ??
    (missingRun ? "The sprint’s agent run could not be found. Retry status to check again." : undefined);
  return { sprint, execution, state, running, error, refreshing, retryStatus,
    loading: sprintQuery.loading || runQuery.loading,
    unavailable: !!sprintQuery.error || !!runQuery.error || missingRun };
}
