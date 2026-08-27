import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  SubtreeRunCapabilityMap,
} from "../../../shared/api/types";
import type { FetchPolicy } from "@apollo/client";
import { publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { assembleScopedWorkflowSettings } from "./scopedWorkflowSettings";
import { issueType, readWorkflowCatalog } from "./projectCatalog";

export async function readWorkflowTransitions(
  projectId: string,
  issueTypeId: string,
): Promise<ScopedWorkflowSettings["transitions"]> {
  const catalog = await readWorkflowCatalog(projectId);
  const type = catalog.issueTypes.find(
    (candidate) => publicWorktrackerId(candidate.id) === issueTypeId,
  );
  return type?.transitions.nodes.map((transition) => ({
    from_state_id: publicWorktrackerId(transition.from_state),
    to_state_id: publicWorktrackerId(transition.to_state),
    agent_allowed: transition.agent_allowed,
  })) ?? [];
}

export async function readWorkflowStates(projectId: string): Promise<State[]> {
  return (await readWorkflowCatalog(projectId)).states;
}

export async function readWorkflowIssueTypes(projectId: string): Promise<IssueType[]> {
  return (await readWorkflowCatalog(projectId)).issueTypes.map(issueType);
}

export async function readSubtreeRunCapabilities(
  projectId: string,
): Promise<SubtreeRunCapabilityMap> {
  const { launchBindings } = await readWorkflowCatalog(projectId);
  const capabilities: SubtreeRunCapabilityMap = {};
  for (const binding of launchBindings) {
    if (!binding.subtree_run_enabled) continue;
    capabilities[binding.issue_type] = [
      ...(capabilities[binding.issue_type] ?? []),
      binding.state,
    ];
  }
  return capabilities;
}

export async function readWorkflowSettings(
  projectId: string,
  issueTypeId: string,
  fetchPolicy: FetchPolicy = "cache-first",
): Promise<ScopedWorkflowSettings> {
  const catalog = await readWorkflowCatalog(projectId, fetchPolicy);
  const selectedType = catalog.issueTypes.find(
    (candidate) => publicWorktrackerId(candidate.id) === issueTypeId,
  );
  if (!selectedType) throw new Error("Work-item type not found.");
  const transitions = selectedType.transitions.nodes.map((transition) => ({
    id: transition.id,
    issue_type: publicWorktrackerId(transition.issue_type),
    from_state: publicWorktrackerId(transition.from_state),
    to_state: publicWorktrackerId(transition.to_state),
    agent_allowed: transition.agent_allowed,
    from_order: transition.fromState?.sort_order ?? Number.MAX_SAFE_INTEGER,
    to_order: transition.toState?.sort_order ?? Number.MAX_SAFE_INTEGER,
  })).sort((left, right) =>
    left.from_order - right.from_order
    || left.to_order - right.to_order
    || left.id - right.id
  ).map(({ from_order: _from, to_order: _to, ...transition }) => transition);

  return assembleScopedWorkflowSettings(
    issueType(selectedType),
    catalog.states,
    transitions,
    catalog.launchBindings,
    catalog.providers,
    catalog.agentModels,
    catalog.reasoningLevels,
    Boolean(catalog.globalDefault),
  );
}
