import type { FetchPolicy } from "@apollo/client";
import type { LaunchBinding, State } from "../types";
import { selectIssueTypeLevel } from "../selectors/issueTypeLevel";
import { publicResult, serverVariables } from "../../../shared/api/worktrackerConversion";
import type { WorkTrackerProjectOpenQuery } from "../../projects";
import { WorkTrackerProjectOpenDocument } from "../../projects";
import { studioApolloClient } from "../../../shared/apollo/client";

type IssueTypeRow = WorkTrackerProjectOpenQuery["issue_types"]["nodes"][number];

export interface WorkflowCatalog {
  states: State[];
  issueTypes: IssueTypeRow[];
  launchBindings: LaunchBinding[];
  providers: WorkTrackerProjectOpenQuery["provider_catalog"]["providers"];
  configurableProviders: WorkTrackerProjectOpenQuery["provider_catalog"]["configurable_providers"];
  agentModels: WorkTrackerProjectOpenQuery["provider_catalog"]["agent_models"];
  reasoningLevels: WorkTrackerProjectOpenQuery["provider_catalog"]["reasoning_levels"];
  globalDefault: WorkTrackerProjectOpenQuery["provider_catalog"]["global_default"];
}

export const issueType = selectIssueTypeLevel;

function normalizeStates(catalog: WorkTrackerProjectOpenQuery) {
  return catalog.states.nodes.slice().sort((left, right) =>
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
      ...binding,
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
  const converted = publicResult(WorkTrackerProjectOpenDocument, catalog);
  return {
    states: normalizeStates(converted),
    issueTypes: normalizeIssueTypes(converted),
    launchBindings: normalizeLaunchBindings(converted),
    providers: converted.provider_catalog.providers,
    configurableProviders: converted.provider_catalog.configurable_providers,
    agentModels: converted.provider_catalog.agent_models,
    reasoningLevels: converted.provider_catalog.reasoning_levels,
    globalDefault: converted.provider_catalog.global_default,
  };
}

export async function readWorkflowCatalog(
  projectId: string,
  fetchPolicy: FetchPolicy = "cache-first",
): Promise<WorkflowCatalog> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerProjectOpenDocument,
    variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
    fetchPolicy,
    ...(fetchPolicy === "network-only" || fetchPolicy === "no-cache"
      ? { context: { queryDeduplication: false } } : {}),
  });
  return normalizedCatalog(data!);
}

export function getWorkflowCatalogSnapshot(
  projectId: string,
): WorkflowCatalog | undefined {
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: serverVariables(WorkTrackerProjectOpenDocument, { projectId }),
    optimistic: true,
  });
  return data?.states && data.issue_types && data.provider_catalog
    ? normalizedCatalog(data as WorkTrackerProjectOpenQuery)
    : undefined;
}
