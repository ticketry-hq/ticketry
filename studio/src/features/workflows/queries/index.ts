import type { IssueType, ScopedWorkflowSettings, State, StateImpact } from "../types";
import type { WorkItem } from "../../work-items";
import type { FetchPolicy } from "@apollo/client";
import type { IssueTypeMetadata } from "../types";
import { publicResult, serverVariables } from "../../../shared/api/worktrackerConversion";
import { studioApolloClient } from "../../../shared/apollo/client";
import { WorkTrackerProjectIssueTypeMetadataDocument } from "./issueTypeMetadata";
import { selectIssueTypeLevel } from "../selectors/issueTypeLevel";
import {
  getStatesSnapshot,
  setStates as setApolloStates,
} from "../../../features/projects";
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
  return readWorkflowSettings(projectId, issueTypeId, fetchPolicy);
}

export {
  getProjectWorkflowSettingsSnapshot,
  useProjectWorkflowSettings,
} from "./workflowSnapshots";
export { setIssueTypeMetadata as setWorkflowIssueTypes } from "./issueTypeMetadata";

export function getWorkflowIssueTypesSnapshot(projectId: string): IssueTypeMetadata[] {
  const projectRows = getWorkflowCatalogSnapshot(projectId)?.issueTypes;
  if (projectRows) return projectRows.map(selectIssueTypeLevel);
  const auxiliary = studioApolloClient().readQuery({
    query: WorkTrackerProjectIssueTypeMetadataDocument,
    variables: serverVariables(WorkTrackerProjectIssueTypeMetadataDocument, { projectId }),
    optimistic: true,
  });
  if (auxiliary) return publicResult(WorkTrackerProjectIssueTypeMetadataDocument, auxiliary)
    .issue_types.nodes.map(selectIssueTypeLevel);
  return EMPTY_ISSUE_TYPES;
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
