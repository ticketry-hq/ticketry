import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  StateImpact,
  WorkItem,
} from "../../../shared/api/types";
import type { FetchPolicy } from "@apollo/client";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  getStatesSnapshot,
  setStates as setApolloStates,
} from "../../../features/projects";
import {
  WorkTrackerProjectIssueTypesDocument,
} from "../../projects";
import { loadProviderCapabilities } from "../providerQueries";
import {
  getProviderCapabilitiesSnapshot,
  setProviderCapabilities,
} from "../providerQueries";
import {
  readSubtreeRunCapabilities,
  readWorkflowIssueTypes,
  readWorkflowSettings,
  readWorkflowStates,
} from "./readTransport";
import { getWorkflowCatalogSnapshot } from "./projectCatalog";
import { readProjectWorkItems } from "../../work-items";

const EMPTY_ISSUE_TYPES: IssueType[] = [];
const EMPTY_CAPABILITIES: WorkflowEditorResources["providerCapabilities"] = [];
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_WORKFLOWS: Record<string, ScopedWorkflowSettings> = {};

const projectWorkflowSettings = new Map<string, Record<string, ScopedWorkflowSettings>>();
const stateCounts = new Map<string, Record<string, number>>();

export interface WorkflowEditorResources {
  issueTypes: IssueType[];
  states: State[];
  providerCapabilities: Awaited<ReturnType<typeof loadProviderCapabilities>>;
  workItems: WorkItem[];
}

export async function loadWorkflowSettings(
  projectId: string,
  issueTypeId: string,
  fetchPolicy: FetchPolicy = "cache-first",
): Promise<ScopedWorkflowSettings> {
  const workflow = await readWorkflowSettings(projectId, issueTypeId, fetchPolicy);
  projectWorkflowSettings.set(projectId, {
    ...(projectWorkflowSettings.get(projectId) ?? {}),
    [workflow.issue_type_id]: workflow,
  });
  return workflow;
}

export function setWorkflowSettings(workflow: ScopedWorkflowSettings): void {
  for (const [projectId, workflows] of projectWorkflowSettings) {
    if (getWorkflowIssueTypesSnapshot(projectId).some(
      (type) => type.id === workflow.issue_type_id,
    )) {
      projectWorkflowSettings.set(projectId, {
        ...workflows,
        [workflow.issue_type_id]: workflow,
      });
      return;
    }
  }
}

export function getWorkflowSettingsSnapshot(
  issueTypeId: string,
): ScopedWorkflowSettings | undefined {
  for (const workflows of projectWorkflowSettings.values()) {
    if (workflows[issueTypeId]) return workflows[issueTypeId];
  }
  return undefined;
}

export function setProjectWorkflowSettings(
  projectId: string,
  workflows: Record<string, ScopedWorkflowSettings>,
): void {
  projectWorkflowSettings.set(projectId, workflows);
}

export function getProjectWorkflowSettingsSnapshot(
  projectId: string,
): Record<string, ScopedWorkflowSettings> {
  return projectWorkflowSettings.get(projectId) ?? EMPTY_WORKFLOWS;
}

export function setWorkflowIssueTypes(
  projectId: string,
  issueTypes: IssueType[],
): void {
  const variables = { projectId: compactWorktrackerId(projectId) };
  const current = studioApolloClient().readQuery({
    query: WorkTrackerProjectIssueTypesDocument,
    variables,
    optimistic: true,
  });
  const currentById = new Map(
    current?.issue_types.nodes.map((row) => [row.id, row]) ?? [],
  );
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectIssueTypesDocument,
    variables,
    data: {
      issue_types: {
        __typename: "WorktrackerIssuetypeConnection",
        nodes: issueTypes.map((type, index) => {
          const id = compactWorktrackerId(type.id);
          const existing = currentById.get(id);
          return {
            __typename: "WorktrackerIssuetype",
            id,
            project: compactWorktrackerId(type.project ?? projectId),
            name: type.name,
            level: type.level,
            color: type.color ?? "",
            sort_order: type.sort_order ?? index,
            start_state: type.start_state
              ? compactWorktrackerId(type.start_state)
              : null,
            workflow_revision: type.workflow_revision ?? 0,
            is_pathfind: existing?.is_pathfind ?? false,
            created_at: existing?.created_at ?? new Date(index).toISOString(),
            updated_at: existing?.updated_at ?? new Date(index).toISOString(),
            transitions: existing?.transitions ?? {
              __typename: "WorktrackerIssuetypetransitionConnection",
              nodes: [],
            },
            launch_bindings: existing?.launch_bindings ?? {
              __typename: "WorktrackerLaunchbindingConnection",
              nodes: [],
            },
          };
        }),
      },
    } as never,
  });
}

export function getWorkflowIssueTypesSnapshot(projectId: string): IssueType[] {
  const projectRows = getWorkflowCatalogSnapshot(projectId)?.issueTypes;
  const auxiliaryRows = studioApolloClient().readQuery({
    query: WorkTrackerProjectIssueTypesDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  })?.issue_types.nodes;
  return (projectRows ?? auxiliaryRows)?.map((row) => ({
    id: publicWorktrackerId(row.id),
    project: publicWorktrackerId(row.project),
    name: row.name,
    level: row.level as IssueType["level"],
    color: row.color,
    sort_order: row.sort_order,
    start_state: row.start_state ? publicWorktrackerId(row.start_state) : null,
    workflow_revision: row.workflow_revision,
  })) ?? EMPTY_ISSUE_TYPES;
}

export function setWorkflowStates(projectId: string, states: State[]): void {
  setApolloStates(projectId, states);
}

export function getWorkflowStatesSnapshot(projectId: string): State[] {
  return getStatesSnapshot(projectId);
}

export function setWorkflowStateCounts(
  projectId: string,
  counts: Record<string, number>,
): void {
  stateCounts.set(projectId, counts);
}

export function getWorkflowStateCountsSnapshot(
  projectId: string,
): Record<string, number> {
  return stateCounts.get(projectId) ?? EMPTY_COUNTS;
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
  return readProjectWorkItems(projectId);
}

export async function loadWorkflowEditorResources(
  projectId: string,
): Promise<WorkflowEditorResources> {
  const [issueTypes, states, providerCapabilities, workItems] = await Promise.all([
    readWorkflowIssueTypes(projectId),
    readWorkflowStates(projectId),
    loadProviderCapabilities(),
    loadWorkflowProjectItems(projectId),
  ]);
  return { issueTypes, states, providerCapabilities, workItems };
}

export function loadWorkflowStates(projectId: string): Promise<State[]> {
  return readWorkflowStates(projectId);
}

export {
  readSubtreeRunCapabilities,
  readWorkflowIssueTypes,
  readWorkflowSettings,
  readWorkflowStates,
};

export async function loadAllWorkflowSettings(
  projectId: string,
  issueTypeIds: string[],
): Promise<ScopedWorkflowSettings[]> {
  return Promise.all(issueTypeIds.map((id) => loadWorkflowSettings(projectId, id)));
}

export async function loadStateImpact(
  projectId: string,
  stateId: string,
): Promise<StateImpact> {
  const states = getWorkflowStatesSnapshot(projectId);
  const state = states.find((candidate) => candidate.id === stateId);
  if (!state) throw new Error("State not found.");

  const workflows = await loadAllWorkflowSettings(
    projectId,
    getWorkflowIssueTypesSnapshot(projectId).map((type) => type.id),
  );
  const totalWorkItems = getWorkflowStateCountsSnapshot(projectId)[stateId] ?? 0;
  const rules: NonNullable<StateImpact["protection_rules"]> = [];
  if (state.is_protected) {
    rules.push({
      code: "protected_state",
      message: `State '${state.name}' is protected and cannot be deleted.`,
    });
  }
  if (states.filter((candidate) => candidate.group === state.group).length <= 1) {
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
      transition.from_state_id === stateId || transition.to_state_id === stateId)
    || workflow.launch_bindings.some((binding) => binding.state_id === stateId)
  );
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
