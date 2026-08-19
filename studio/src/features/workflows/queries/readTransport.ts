import { studioRuntime } from "../../../runtime";
import * as rest from "../../../shared/api/client";
import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  SubtreeRunCapabilityMap,
} from "../../../shared/api/types";
import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { WorkTrackerIssueTypeTransitionsDocument } from "../generated/operations";
import { LoadProviderCatalogDocument } from "../../settings/generated/providerCatalog";
import { issueType, readWorkflowCatalog } from "./catalogTransport";

export function readWorkflowStates(
  projectId: string,
  restReader: (projectId: string) => Promise<State[]> = rest.getStates,
): Promise<State[]> {
  return studioRuntime().readWorkTracker({
    rest: () => restReader(projectId),
    graphQl: async (execute) =>
      (await readWorkflowCatalog(execute, projectId)).states,
  });
}

export function readWorkflowIssueTypes(
  projectId: string,
  restReader: (projectId: string) => Promise<IssueType[]> = rest.getIssueTypes,
): Promise<IssueType[]> {
  return studioRuntime().readWorkTracker({
    rest: () => restReader(projectId),
    graphQl: async (execute) =>
      (await readWorkflowCatalog(execute, projectId)).issueTypes.map(issueType),
  });
}

export function readSubtreeRunCapabilities(
  projectId: string,
): Promise<SubtreeRunCapabilityMap> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listSubtreeRunCapabilities(projectId),
    graphQl: async (execute) => {
      const { launchBindings } = await readWorkflowCatalog(execute, projectId);
      const capabilities: SubtreeRunCapabilityMap = {};
      for (const binding of launchBindings) {
        if (!binding.subtree_run_enabled) continue;
        capabilities[binding.issue_type] = [
          ...(capabilities[binding.issue_type] ?? []),
          binding.state,
        ];
      }
      return capabilities;
    },
  });
}

export function readWorkflowSettings(
  projectId: string,
  issueTypeId: string,
): Promise<ScopedWorkflowSettings> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.getIssueTypeWorkflowSettings(projectId, issueTypeId),
    graphQl: async (execute) => {
      const [normalized, transitionResult, providerCatalog] = await Promise.all([
        readWorkflowCatalog(execute, projectId),
        execute(WorkTrackerIssueTypeTransitionsDocument, {
          issueTypeId: compactWorktrackerId(issueTypeId),
        }),
        execute(LoadProviderCatalogDocument, {}),
      ]);
      const selectedType = normalized.issueTypes.find(
        (candidate) => publicWorktrackerId(candidate.id) === issueTypeId,
      );
      if (!selectedType) throw new Error("Work-item type not found.");
      return rest.assembleScopedWorkflowSettings(
        issueType(selectedType),
        normalized.states,
        transitionResult.issue_type_transitions.nodes.map((transition) => ({
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
        ).map(({ from_order: _from, to_order: _to, ...transition }) => transition),
        normalized.launchBindings,
        normalized.providers,
        normalized.agentModels,
        normalized.reasoningLevels,
        Boolean(providerCatalog.provider_catalog.global_default),
      );
    },
  });
}
