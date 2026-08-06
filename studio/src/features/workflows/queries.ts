import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
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
import type { StateImpactOut } from "@worktracker/typescript-sdk";

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
  issueTypeId: string,
): Promise<ScopedWorkflowSettings> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workflows.byIssueType(issueTypeId),
    queryFn: () => api.getIssueTypeWorkflowSettings(issueTypeId),
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
  return queryClient.fetchQuery({
    queryKey: queryKeys.workItems.byProject(projectId, {
      includeArchived: true,
      includePathfind: true,
    }),
    queryFn: () => api.getProjectWorkItems(projectId),
    staleTime: 0,
  });
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
  issueTypeIds: string[],
): Promise<ScopedWorkflowSettings[]> {
  return Promise.all(issueTypeIds.map(loadWorkflowSettings));
}

export function loadStateImpact(stateId: string): Promise<StateImpactOut> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workflows.stateImpact(stateId),
    queryFn: () => api.getStateImpact(stateId),
    staleTime: 0,
  });
}
