import { useState } from "react";
import { useApolloClient, useMutation } from "@apollo/client/react";
import { CancelSprintSuggestionExecutionDocument } from "../generated/sprints.documents";
import { openPlanSprint } from "../planWorkspaceState";
import { launchSuggestionRun } from "./launchSuggestionRun";
import { useSprintSuggestionExecution } from "./useSprintSuggestionExecution";
import { SuggestionStatusRecovery } from "./SuggestionStatusRecovery";

export function SuggestionAgentBox({ projectId, sprintId }: { projectId: string; sprintId: string }) {
  const client = useApolloClient();
  const status = useSprintSuggestionExecution(sprintId);
  const { sprint, execution, state, running, loading, unavailable } = status;
  const [launchState, setLaunchState] = useState<
    { kind: "idle" } | { kind: "launching" } | { kind: "failed"; message: string }
  >({ kind: "idle" });
  const launching = launchState.kind === "launching";
  const [cancel, cancelState] = useMutation(CancelSprintSuggestionExecutionDocument, {
    refetchQueries: ["SprintSuggestionExecution", "SprintSuggestionExecutionRun"], awaitRefetchQueries: true,
  });
  if (sprint?.status === "completed") return null;
  const goals = sprint?.goals?.nodes ?? [];
  const error = (launchState.kind === "failed" ? launchState.message : undefined) ?? cancelState.error?.message;
  const start = () => {
    if (launching || running || !sprint || goals.length === 0 || loading || unavailable || status.refreshing) return;
    setLaunchState({ kind: "launching" });
    void launchSuggestionRun({ projectId, id: sprintId }, client).then(
      () => setLaunchState({ kind: "idle" }),
      (error: unknown) => setLaunchState({ kind: "failed", message: error instanceof Error ? error.message : String(error) }),
    );
  };
  if ((!sprint || !execution) && loading && !status.error && !status.refreshing) return <p role="status">Loading agent status…</p>;
  return <div className="space-y-1 text-sm text-text-secondary" aria-label="Sprint suggestion agent">
    {error && <p role="alert">{error}</p>}
    <SuggestionStatusRecovery error={status.error} refreshing={status.refreshing} onRetry={status.retryStatus} />
    {running ? <>
      <p role="status">An agent is looking for stories…</p>
      <div role="progressbar" aria-label="Finding stories" className="h-1 bg-focus-accent" />
      <button type="button" disabled={cancelState.loading} onClick={() => {
        if (execution) void cancel({ variables: { projectId, id: execution.id } }).catch(() => {});
      }}>Cancel</button>
    </> : <>
      {state.kind === "stale" && <p>Goals changed since the agent ran</p>}
      {state.kind === "done" && <p>{state.waitingCount} suggestions ready <button type="button" onClick={() => openPlanSprint(sprintId)}>Review in Plan →</button></p>}
      {state.kind === "error" && <p role="alert">The agent couldn’t finish. {state.message}</p>}
      {state.kind === "cancelled" && <p>Agent cancelled. Your goals are kept.</p>}
      {sprint && goals.length === 0 && <p>Add goals, then an agent can look for stories that fit them.</p>}
      <button type="button" disabled={!sprint || goals.length === 0 || launching || loading || unavailable || status.refreshing} onClick={start}>
        {launching ? "Starting…" : launchState.kind === "failed" || state.kind === "error" || state.kind === "cancelled" ? "Retry" : execution ? "Find stories again" : "Find stories for these goals"}
      </button>
    </>}
  </div>;
}
