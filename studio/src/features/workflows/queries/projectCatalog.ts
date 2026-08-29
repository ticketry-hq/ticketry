import type { FetchPolicy } from "@apollo/client";
import type { IssueType } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
  publicWorktrackerTimestamp,
  stringList,
} from "../../../shared/api/generatedWorktracker";
import type { WorkTrackerProjectOpenQuery } from "../../projects";
import { readProjectOpen, WorkTrackerProjectOpenDocument } from "../../projects";
import { studioApolloClient } from "../../../shared/apollo/client";

type IssueTypeRow = WorkTrackerProjectOpenQuery["issue_types"]["nodes"][number];

export interface WorkflowCatalog {
  states: ReturnType<typeof normalizeStates>;
  issueTypes: IssueTypeRow[];
  launchBindings: ReturnType<typeof normalizeLaunchBindings>;
  providers: WorkTrackerProjectOpenQuery["provider_catalog"]["providers"];
  configurableProviders: WorkTrackerProjectOpenQuery["provider_catalog"]["configurable_providers"];
  agentModels: WorkTrackerProjectOpenQuery["provider_catalog"]["agent_models"];
  reasoningLevels: WorkTrackerProjectOpenQuery["provider_catalog"]["reasoning_levels"];
  globalDefault: WorkTrackerProjectOpenQuery["provider_catalog"]["global_default"];
}

export function issueType(row: IssueTypeRow): IssueType {
  return {
    id: publicWorktrackerId(row.id),
    project: publicWorktrackerId(row.project),
    name: row.name,
    level: row.level as IssueType["level"],
    color: row.color,
    sort_order: row.sort_order,
    start_state: row.start_state ? publicWorktrackerId(row.start_state) : null,
    workflow_revision: row.workflow_revision,
  };
}

function normalizeStates(catalog: WorkTrackerProjectOpenQuery) {
  return catalog.states.nodes.map((state) => ({
    ...state,
    id: publicWorktrackerId(state.id),
    project: publicWorktrackerId(state.project),
    created_at: publicWorktrackerTimestamp(state.created_at),
    updated_at: publicWorktrackerTimestamp(state.updated_at),
  })).sort((left, right) =>
    left.sort_order - right.sort_order
    || left.created_at.localeCompare(right.created_at)
  );
}

function normalizeIssueTypes(catalog: WorkTrackerProjectOpenQuery) {
  return catalog.issue_types.nodes.slice().sort((left, right) =>
    left.sort_order - right.sort_order
    || left.created_at.localeCompare(right.created_at)
  );
}

function normalizeLaunchBindings(catalog: WorkTrackerProjectOpenQuery) {
  return catalog.issue_types.nodes.flatMap((type) =>
    type.launch_bindings.nodes.map((binding) => ({
      id: binding.id,
      issue_type: publicWorktrackerId(binding.issue_type),
      state: publicWorktrackerId(binding.state),
      prompt: binding.prompt,
      required_skills: stringList(binding.required_skills),
      model: binding.model ? publicWorktrackerId(binding.model) : null,
      reasoning: binding.reasoning ? publicWorktrackerId(binding.reasoning) : null,
      auto_start: binding.auto_start,
      subtree_run_enabled: binding.subtree_run_enabled,
      created_at: publicWorktrackerTimestamp(binding.created_at),
      updated_at: publicWorktrackerTimestamp(binding.updated_at),
      issue_type_order: type.sort_order,
      state_order: binding.state_record?.sort_order ?? Number.MAX_SAFE_INTEGER,
    })),
  ).sort((left, right) =>
    left.issue_type_order - right.issue_type_order
    || left.state_order - right.state_order
    || left.id - right.id
  ).map(({ issue_type_order: _typeOrder, state_order: _stateOrder, ...binding }) => binding);
}

export function normalizedCatalog(
  catalog: WorkTrackerProjectOpenQuery,
): WorkflowCatalog {
  return {
    states: normalizeStates(catalog),
    issueTypes: normalizeIssueTypes(catalog),
    launchBindings: normalizeLaunchBindings(catalog),
    providers: catalog.provider_catalog.providers,
    configurableProviders: catalog.provider_catalog.configurable_providers,
    agentModels: catalog.provider_catalog.agent_models,
    reasoningLevels: catalog.provider_catalog.reasoning_levels,
    globalDefault: catalog.provider_catalog.global_default,
  };
}

export async function readWorkflowCatalog(
  projectId: string,
  fetchPolicy: FetchPolicy = "cache-first",
): Promise<WorkflowCatalog> {
  return normalizedCatalog((await readProjectOpen(projectId, fetchPolicy)).data);
}

export function getWorkflowCatalogSnapshot(
  projectId: string,
): WorkflowCatalog | undefined {
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  return data?.states && data.issue_types && data.provider_catalog
    ? normalizedCatalog(data as WorkTrackerProjectOpenQuery)
    : undefined;
}
