import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useTerminalStore, type SessionMeta } from "../agents/terminal/appNavigation";
import { launchFailureMessage } from "../agents/terminal";
import { toast, useClientStore } from "../../state/clientStore";
import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  WorkItem,
} from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { getStatesSnapshot } from "../../shared/query/stateCatalog";
import { getIssueTypesSnapshot } from "../settings";
import {
  RunNowRefusalError,
  runWorkItemNow,
  type RunNowResponse,
} from "./internal/runNowTransport";
import { readWorkflowTransitions } from "../workflows/queries/readTransport";

type WorkflowTransitions = ScopedWorkflowSettings["transitions"];

const pendingIds = new Set<string>();
const pendingListeners = new Set<() => void>();

function publishPending(): void {
  pendingListeners.forEach((listener) => listener());
}

function setPending(issueId: string, pending: boolean): void {
  if (pending) pendingIds.add(issueId);
  else pendingIds.delete(issueId);
  publishPending();
}

function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

export function useRunNowPending(issueId: string): boolean {
  return useSyncExternalStore(
    subscribePending,
    () => pendingIds.has(issueId),
    () => false,
  );
}

export function useRunNowTransitions(
  issueTypeId: string | null,
  enabled: boolean,
): WorkflowTransitions | undefined {
  return useQuery(
    {
      queryKey: queryKeys.workflows.transitionsByIssueType(issueTypeId ?? "none"),
      queryFn: () => readWorkflowTransitions(issueTypeId!),
      enabled: enabled && issueTypeId !== null,
    },
    queryClient,
  ).data;
}

function namedState(
  states: readonly State[],
  name: string,
): (State & { id: string }) | null {
  const state = states.find(
    (candidate): candidate is State & { id: string } =>
      candidate.name === name && typeof candidate.id === "string",
  );
  return state ?? null;
}

export function isRunNowEligible(
  item: WorkItem,
  states: readonly State[],
  issueTypes: readonly IssueType[],
  transitions: WorkflowTransitions | undefined,
): boolean {
  const issueType = issueTypes.find((candidate) => candidate.id === item.issue_type);
  const ideas = namedState(states, "Ideas");
  const implement = namedState(states, "Implement");
  return (
    issueType?.name === "Story" &&
    item.state === ideas?.id &&
    transitions?.some(
      (transition) =>
        transition.from_state_id === ideas.id &&
        transition.to_state_id === implement?.id,
    ) === true
  );
}

function reconcileCommittedState(
  item: WorkItem,
  committedState: { id: string; name: string } | null,
): void {
  if (!committedState) return;
  queryClient.setQueryData<WorkItem>(
    queryKeys.workItems.byId(item.id),
    (current) => current ? { ...current, state: committedState.id } : current,
  );
}

function committedStateFromError(error: unknown): { id: string; name: string } | null {
  return error instanceof RunNowRefusalError ? error.body.committed_state : null;
}

function refusalMessage(error: unknown): string {
  if (error instanceof RunNowRefusalError) {
    const { code, detail, remedy } = error.body;
    if (code === "task_already_active") {
      return "An agent is already running for this Story. Close its terminal before trying again.";
    }
    if (code === "binding_not_configured") {
      return "Configure an Implement launch binding before trying again.";
    }
    if (code === "module_id_required") {
      return "Place this Story in a module before trying again.";
    }
    if (code === "run_now_not_eligible") {
      return "This Story is no longer eligible to Run now. Refresh its workflow and try again.";
    }
    if (remedy) return `${detail} Next action: ${remedy}`;
  }
  return launchFailureMessage(error);
}

function activateRunTerminal(
  item: WorkItem,
  moduleId: string | null,
  response: RunNowResponse,
): void {
  useTerminalStore.getState().openSession({
    taskId: item.id,
    projectId: item.project_id,
    moduleId: moduleId ?? undefined,
    agent: response.run.agent as SessionMeta["agent"],
    agentRunId: response.run.agent_run_id,
    select: true,
  });
  useClientStore.getState().setActive(item.id, "terminal");
}

export function startRunNow(item: WorkItem, moduleId: string | null): boolean {
  if (pendingIds.has(item.id)) return false;
  const transitions = queryClient.getQueryData<WorkflowTransitions>(
    queryKeys.workflows.transitionsByIssueType(item.issue_type ?? "none"),
  );
  if (
    !isRunNowEligible(
      item,
      getStatesSnapshot(item.project_id),
      getIssueTypesSnapshot(item.project_id),
      transitions,
    )
  ) {
    return false;
  }

  setPending(item.id, true);
  void runWorkItemNow(item.id).then((response) => {
    reconcileCommittedState(item, response.committed_state);
    activateRunTerminal(item, moduleId, response);
    toast.success("Run now started.");
  }).catch((error: unknown) => {
    reconcileCommittedState(item, committedStateFromError(error));
    toast.error(`Run now could not be started: ${refusalMessage(error)}`);
  }).finally(() => setPending(item.id, false));
  return true;
}

export function startRunNowForSelectedItem(): boolean {
  const ui = useClientStore.getState();
  const item = ui.selectedTaskId
    ? queryClient.getQueryData<WorkItem>(queryKeys.workItems.byId(ui.selectedTaskId))
    : undefined;
  return item ? startRunNow(item, ui.selectedModuleId) : false;
}
