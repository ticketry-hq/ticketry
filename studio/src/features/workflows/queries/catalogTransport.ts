import type { WorkTrackerGraphQlExecute } from "../../../runtime";
import type { IssueType } from "../../../shared/api/types";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import {
  compactWorktrackerId,
  publicWorktrackerId,
  publicWorktrackerTimestamp,
  stringList,
} from "../../../shared/api/generatedWorktracker";
import {
  WorkTrackerWorkflowCatalogDocument,
  type WorkTrackerIssueType,
  type WorkTrackerWorkflowCatalogQuery,
} from "../generated/operations";

// One GraphQL document carries every workflow-catalogue collection, so the
// state, issue-type, launch-binding and workflow-settings readers all want the
// same round-trip. They share it through a single cache entry per project:
// concurrent callers (a settings load fires three readers at once) join the
// one in-flight fetch instead of each sending an identical query, while a
// later load still refetches because the entry is always stale.

export interface WorkflowCatalog {
  states: ReturnType<typeof normalizeStates>;
  issueTypes: WorkTrackerIssueType[];
  launchBindings: ReturnType<typeof normalizeLaunchBindings>;
  providers: ReturnType<typeof normalizeProviders>;
  agentModels: ReturnType<typeof normalizeAgentModels>;
  reasoningLevels: ReturnType<typeof normalizeReasoningLevels>;
}

export function issueType(row: WorkTrackerIssueType): IssueType {
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

function normalizeStates(catalog: WorkTrackerWorkflowCatalogQuery) {
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

function normalizeIssueTypes(catalog: WorkTrackerWorkflowCatalogQuery) {
  return catalog.issue_types.nodes
    .slice()
    .sort((left, right) =>
      left.sort_order - right.sort_order
      || left.created_at.localeCompare(right.created_at)
    );
}

function normalizeLaunchBindings(catalog: WorkTrackerWorkflowCatalogQuery) {
  return catalog.launch_bindings.nodes.map((binding) => ({
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
    issue_type_order: binding.issueType?.sort_order ?? Number.MAX_SAFE_INTEGER,
    state_order: binding.state_record?.sort_order ?? Number.MAX_SAFE_INTEGER,
  })).sort((left, right) =>
    left.issue_type_order - right.issue_type_order
    || left.state_order - right.state_order
    || left.id - right.id
  ).map(({ issue_type_order: _issueOrder, state_order: _stateOrder, ...binding }) => binding);
}

function normalizeProviders(catalog: WorkTrackerWorkflowCatalogQuery) {
  return catalog.providers.nodes.map((provider) => ({
    ...provider,
    id: publicWorktrackerId(provider.id),
  })).sort((left, right) => left.slug.localeCompare(right.slug));
}

function normalizeAgentModels(catalog: WorkTrackerWorkflowCatalogQuery) {
  return catalog.agent_models.nodes.map((model) => ({
    id: publicWorktrackerId(model.id),
    provider: publicWorktrackerId(model.provider),
    name: model.name,
    provider_slug: model.provider_record?.slug ?? "",
    permitted_reasoning_levels: model.reasoning_levels.nodes.map((relation) =>
      publicWorktrackerId(relation.reasoning_level_id)
    ),
  })).sort((left, right) =>
    left.provider_slug.localeCompare(right.provider_slug)
    || left.name.localeCompare(right.name)
  ).map(({ provider_slug: _slug, ...model }) => model);
}

function normalizeReasoningLevels(catalog: WorkTrackerWorkflowCatalogQuery) {
  return catalog.reasoning_levels.nodes.map((level) => ({
    ...level,
    id: publicWorktrackerId(level.id),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizedCatalog(
  catalog: WorkTrackerWorkflowCatalogQuery,
): WorkflowCatalog {
  return {
    states: normalizeStates(catalog),
    issueTypes: normalizeIssueTypes(catalog),
    launchBindings: normalizeLaunchBindings(catalog),
    providers: normalizeProviders(catalog),
    agentModels: normalizeAgentModels(catalog),
    reasoningLevels: normalizeReasoningLevels(catalog),
  };
}

/**
 * Read the normalized workflow catalogue for a project through the shared
 * per-project cache entry, so readers that each need one collection cost one
 * catalogue round-trip between them.
 */
export function readWorkflowCatalog(
  execute: WorkTrackerGraphQlExecute,
  projectId: string,
): Promise<WorkflowCatalog> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.workflows.catalog(projectId),
    queryFn: async () =>
      normalizedCatalog(
        await execute(WorkTrackerWorkflowCatalogDocument, {
          projectId: compactWorktrackerId(projectId),
        }),
      ),
    staleTime: 0,
  });
}
