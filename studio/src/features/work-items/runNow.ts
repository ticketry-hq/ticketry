import { skipToken, useQuery } from "@apollo/client/react";
import { useSyncExternalStore } from "react";
import { launchFailureMessage } from "../agents/terminal";
import { toast, useClientStore } from "../../state/clientStore";
import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  WorkItem,
} from "../../shared/api/types";
import { compactWorktrackerId, publicWorktrackerId } from "../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../shared/apollo/client";
import { getStatesSnapshot } from "../../features/projects";
import { getIssueTypesSnapshot } from "../settings";
import {
  RunNowRefusalError,
  runWorkItemNow,
} from "./internal/runNowTransport";
import {
  activateAcknowledgedTaskRunTab,
  watchNewTaskRunTab,
} from "./taskRunTabActivation";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { WorkTrackerModuleOpenDocument } from "./generated/workItems.documents";
import { workItemFromIssue } from "./issueAdapter";
import { getWorkItemSnapshot } from "./queries";

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
  projectId: string,
  issueTypeId: string | null,
  enabled: boolean,
): WorkflowTransitions | undefined {
  const query = useQuery(
    WorkTrackerProjectOpenDocument,
    enabled && issueTypeId
      ? {
          variables: { projectId: compactWorktrackerId(projectId) },
          client: studioApolloClient(),
          fetchPolicy: "cache-first",
        }
      : skipToken,
  );
  const type = query.data?.issue_types.nodes.find(
    (candidate) => publicWorktrackerId(candidate.id) === issueTypeId,
  );
  return type?.transitions.nodes.map((transition) => ({
    from_state_id: publicWorktrackerId(transition.from_state),
    to_state_id: publicWorktrackerId(transition.to_state),
    agent_allowed: transition.agent_allowed,
  }));
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
  const client = studioApolloClient();
  const cacheId = client.cache.identify({
    __typename: "WorktrackerIssue",
    id: compactWorktrackerId(item.id),
  });
  if (!cacheId) return;
  client.cache.modify({
    id: cacheId,
    fields: {
      stateId: () => compactWorktrackerId(committedState.id),
      state: (_current, { toReference }) => toReference({
        __typename: "WorktrackerState",
        id: compactWorktrackerId(committedState.id),
      }),
    },
  });
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

export function startRunNow(item: WorkItem, moduleId: string | null): boolean {
  if (pendingIds.has(item.id)) return false;
  const projectOpen = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(item.project_id) },
    optimistic: true,
    returnPartialData: true,
  });
  const type = projectOpen?.issue_types?.nodes.find(
    (candidate) => publicWorktrackerId(candidate.id) === item.issue_type,
  );
  const transitions = type?.transitions.nodes.map((transition) => ({
    from_state_id: publicWorktrackerId(transition.from_state),
    to_state_id: publicWorktrackerId(transition.to_state),
    agent_allowed: transition.agent_allowed,
  }));
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
  const tabTarget = {
    taskId: item.id,
    projectId: item.project_id,
    moduleId,
  };
  const runTabWatch = watchNewTaskRunTab(tabTarget);
  void runWorkItemNow(item.id).then((response) => {
    runTabWatch.acknowledge();
    runTabWatch.cancel();
    reconcileCommittedState(item, response.committed_state);
    activateAcknowledgedTaskRunTab(tabTarget, response.run);
    toast.success("Run now started.");
  }).catch((error: unknown) => {
    runTabWatch.cancel();
    reconcileCommittedState(item, committedStateFromError(error));
    toast.error(`Run now could not be started: ${refusalMessage(error)}`);
  }).finally(() => setPending(item.id, false));
  return true;
}

export function startRunNowForSelectedItem(): boolean {
  const ui = useClientStore.getState();
  const opened = ui.selectedModuleId
    ? studioApolloClient().readQuery({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(ui.selectedModuleId) },
        optimistic: true,
        returnPartialData: true,
      })
    : undefined;
  const row = opened?.work_items?.nodes.find(
    (candidate) => publicWorktrackerId(candidate.id) === ui.selectedTaskId,
  );
  const item = row
    ? workItemFromIssue(row)
    : getWorkItemSnapshot(ui.selectedTaskId);
  return item ? startRunNow(item, ui.selectedModuleId) : false;
}
