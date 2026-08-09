import type {
  IssueType,
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
  State,
  StateImpact,
  WorkItem,
} from "../../shared/api/types";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import * as api from "../../shared/api/client";
import { loadProviderCapabilities } from "./providerQueries";
import {
  getProviderCapabilitiesSnapshot,
  setProviderCapabilities,
} from "./providerQueries";

const EMPTY_ISSUE_TYPES: IssueType[] = [];
const EMPTY_STATES: State[] = [];
const EMPTY_CAPABILITIES: WorkflowEditorResources["providerCapabilities"] = [];
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_WORKFLOWS: Record<string, ScopedWorkflowSettings> = {};

export interface WorkflowEditorResources {
  issueTypes: IssueType[];
  states: State[];
  providerCapabilities: Awaited<
    ReturnType<typeof loadProviderCapabilities>
  >;
  workItems: WorkItem[];
}

export async function loadWorkflowSettings(
  projectId: string,
  issueTypeId: string,
): Promise<ScopedWorkflowSettings> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workflows.byIssueType(issueTypeId),
    queryFn: () => api.getIssueTypeWorkflowSettings(projectId, issueTypeId),
    staleTime: 0,
  });
}

export function setWorkflowSettings(
  workflow: ScopedWorkflowSettings,
): void {
  queryClient.setQueryData(
    queryKeys.workflows.byIssueType(workflow.issue_type_id),
    workflow,
  );
}

export function getWorkflowSettingsSnapshot(
  issueTypeId: string,
): ScopedWorkflowSettings | undefined {
  return queryClient.getQueryData(
    queryKeys.workflows.byIssueType(issueTypeId),
  );
}

export function setProjectWorkflowSettings(
  projectId: string,
  workflows: Record<string, ScopedWorkflowSettings>,
): void {
  queryClient.setQueryData(queryKeys.workflows.byProject(projectId), workflows);
  Object.values(workflows).forEach(setWorkflowSettings);
}

export function getProjectWorkflowSettingsSnapshot(
  projectId: string,
): Record<string, ScopedWorkflowSettings> {
  return (
    queryClient.getQueryData<Record<string, ScopedWorkflowSettings>>(
      queryKeys.workflows.byProject(projectId),
    ) ?? EMPTY_WORKFLOWS
  );
}

export function setWorkflowIssueTypes(
  projectId: string,
  issueTypes: IssueType[],
): void {
  queryClient.setQueryData(queryKeys.issueTypes.byProject(projectId), issueTypes);
}

export function getWorkflowIssueTypesSnapshot(projectId: string): IssueType[] {
  return (
    queryClient.getQueryData<IssueType[]>(
      queryKeys.issueTypes.byProject(projectId),
    ) ?? EMPTY_ISSUE_TYPES
  );
}

export function setWorkflowStates(projectId: string, states: State[]): void {
  queryClient.setQueryData(queryKeys.states.byProject(projectId), states);
}

export function getWorkflowStatesSnapshot(projectId: string): State[] {
  return (
    queryClient.getQueryData<State[]>(queryKeys.states.byProject(projectId)) ??
    EMPTY_STATES
  );
}

export function setWorkflowStateCounts(
  projectId: string,
  counts: Record<string, number>,
): void {
  queryClient.setQueryData(queryKeys.workflows.stateCounts(projectId), counts);
}

export function getWorkflowStateCountsSnapshot(
  projectId: string,
): Record<string, number> {
  return (
    queryClient.getQueryData<Record<string, number>>(
      queryKeys.workflows.stateCounts(projectId),
    ) ?? EMPTY_COUNTS
  );
}

export function setWorkflowProviderCapabilities(
  capabilities: WorkflowEditorResources["providerCapabilities"],
): void {
  setProviderCapabilities(capabilities);
}

export function getWorkflowProviderCapabilitiesSnapshot(): WorkflowEditorResources["providerCapabilities"] {
  return getProviderCapabilitiesSnapshot() ?? EMPTY_CAPABILITIES;
}

export async function loadWorkflowProjectItems(
  projectId: string,
): Promise<WorkItem[]> {
  return api.getProjectWorkItems(projectId);
}

export async function loadWorkflowEditorResources(
  projectId: string,
): Promise<WorkflowEditorResources> {
  const existingStates = getWorkflowStatesSnapshot(projectId);
  const [issueTypes, states, providerCapabilities, workItems] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.issueTypes.byProject(projectId),
      queryFn: () => api.getIssueTypes(projectId),
      staleTime: 0,
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.states.byProject(projectId),
      // A configured project cannot have a genuinely empty workflow catalog.
      // Preserve a catalog already published by the planning surface when an
      // editor bootstrap endpoint transiently yields an empty response.
      queryFn: async () => {
        const fetched = await api.getStates(projectId);
        return fetched.length > 0 ? fetched : existingStates;
      },
      staleTime: 0,
    }),
    loadProviderCapabilities(),
    loadWorkflowProjectItems(projectId),
  ]);
  return {
    issueTypes,
    states,
    providerCapabilities,
    workItems,
  };
}

export function loadWorkflowStates(projectId: string): Promise<State[]> {
  const existingStates = getWorkflowStatesSnapshot(projectId);
  return queryClient.fetchQuery({
    queryKey: queryKeys.states.byProject(projectId),
    queryFn: async () => {
      const fetched = await api.getStates(projectId);
      return fetched.length > 0 ? fetched : existingStates;
    },
    staleTime: 0,
  });
}

export async function loadAllWorkflowSettings(
  projectId: string,
  issueTypeIds: string[],
): Promise<ScopedWorkflowSettings[]> {
  return Promise.all(
    issueTypeIds.map((issueTypeId) => loadWorkflowSettings(projectId, issueTypeId)),
  );
}

function reachableStateIds(
  startStateId: string | null,
  transitions: ScopedWorkflowSettings["transitions"],
): Set<string> {
  if (!startStateId) return new Set();
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from_state_id, [
      ...(outgoing.get(transition.from_state_id) ?? []),
      transition.to_state_id,
    ]);
  }
  const reachable = new Set([startStateId]);
  const queue = [startStateId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const target of outgoing.get(current) ?? []) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
}

export function deriveWorkflowImpact(
  workflow: ScopedWorkflowSettings,
  operation: ScopedWorkflowImpactOperation,
): ScopedWorkflowImpact {
  let nextStartStateId = workflow.start_state_id;
  const directlyRemoved = new Set<string>();
  if (operation.operation === "remove_state") {
    if (operation.state_id === workflow.start_state_id) {
      throw new Error(
        "The workflow start state cannot be removed; change the start state instead.",
      );
    }
    for (const transition of workflow.transitions) {
      if (
        transition.from_state_id === operation.state_id
        || transition.to_state_id === operation.state_id
      ) {
        directlyRemoved.add(
          `${transition.from_state_id}:${transition.to_state_id}`,
        );
      }
    }
  } else if (operation.operation === "remove_transition") {
    directlyRemoved.add(
      `${operation.from_state_id}:${operation.to_state_id}`,
    );
  } else {
    nextStartStateId = operation.state_id;
  }

  const remaining = workflow.transitions.filter(
    (transition) => !directlyRemoved.has(
      `${transition.from_state_id}:${transition.to_state_id}`,
    ),
  );
  const reachable = reachableStateIds(nextStartStateId, remaining);
  const deletedTransitions = workflow.transitions.filter((transition) =>
    directlyRemoved.has(
      `${transition.from_state_id}:${transition.to_state_id}`,
    )
    || !reachable.has(transition.from_state_id)
    || !reachable.has(transition.to_state_id));
  const deletedLaunchBindings = workflow.launch_bindings.filter(
    (binding) => !reachable.has(binding.state_id),
  );
  return {
    workflow_revision: workflow.workflow_revision,
    deleted_transitions: deletedTransitions,
    deleted_launch_bindings: deletedLaunchBindings,
    disabled_auto_start_state_ids: deletedLaunchBindings
      .filter((binding) => binding.auto_start)
      .map((binding) => binding.state_id),
  };
}

export async function loadStateImpact(
  projectId: string,
  stateId: string,
): Promise<StateImpact> {
  const state = getWorkflowStatesSnapshot(projectId).find(
    (candidate) => candidate.id === stateId,
  );
  if (!state) throw new Error("State not found.");

  const issueTypeIds = getWorkflowIssueTypesSnapshot(projectId).map(
    (issueType) => issueType.id,
  );
  const workflows = await loadAllWorkflowSettings(projectId, issueTypeIds);
  const totalWorkItems = getWorkflowStateCountsSnapshot(projectId)[stateId] ?? 0;
  const rules: NonNullable<StateImpact["protection_rules"]> = [];
  if (state.is_protected) {
    rules.push({
      code: "protected_state",
      message: `State '${state.name}' is protected and cannot be deleted.`,
    });
  }
  if (
    getWorkflowStatesSnapshot(projectId).filter(
      (candidate) => candidate.group === state.group,
    ).length <= 1
  ) {
    rules.push({
      code: "last_state_in_group",
      message: `State '${state.name}' is the last state in its group and cannot be deleted.`,
    });
  }
  if (totalWorkItems > 0) {
    rules.push({
      code: "occupied_state",
      message: `State '${state.name}' is occupied by ${totalWorkItems} work item(s) and cannot be deleted. Empty the state first.`,
    });
  }
  const referenced = workflows.some((workflow) =>
    workflow.start_state_id === stateId
    || workflow.transitions.some((transition) =>
      transition.from_state_id === stateId
      || transition.to_state_id === stateId)
    || workflow.launch_bindings.some((binding) => binding.state_id === stateId));
  if (referenced) {
    rules.push({
      code: "workflow_referenced",
      message: `State '${state.name}' is referenced by workflow configuration and cannot be deleted.`,
    });
  }
  return {
    state_id: stateId,
    total_work_items: totalWorkItems,
    protection_rules: rules,
  };
}
