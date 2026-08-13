import { studioRuntime } from "../../../runtime";
import * as rest from "../../../shared/api/client";
import type {
  IssueType,
  ScopedWorkflowSettings,
  State,
  SubtreeRunCapabilityMap,
} from "../../../shared/api/types";
import {
  WorkTrackerIssueTypeTransitionsDocument,
  WorkTrackerWorkflowCatalogDocument,
  type WorkTrackerIssueType,
} from "../generated/operations";
import { LoadProviderCatalogDocument } from "../../settings/generated/providerCatalog";

function issueType(row: WorkTrackerIssueType): IssueType {
  return {
    id: row.id,
    project: row.project,
    name: row.name,
    level: row.level as IssueType["level"],
    color: row.color,
    sort_order: row.sort_order,
    start_state: row.start_state,
    workflow_revision: row.workflow_revision,
  };
}

export function readWorkflowStates(
  projectId: string,
  restReader: (projectId: string) => Promise<State[]> = rest.getStates,
): Promise<State[]> {
  return studioRuntime().readWorkTracker({
    rest: () => restReader(projectId),
    graphQl: async (execute) => (
      await execute(WorkTrackerWorkflowCatalogDocument, { projectId })
    ).states.map((state) => ({ ...state })),
  });
}

export function readWorkflowIssueTypes(
  projectId: string,
  restReader: (projectId: string) => Promise<IssueType[]> = rest.getIssueTypes,
): Promise<IssueType[]> {
  return studioRuntime().readWorkTracker({
    rest: () => restReader(projectId),
    graphQl: async (execute) => (
      await execute(WorkTrackerWorkflowCatalogDocument, { projectId })
    ).issue_types.map(issueType),
  });
}

export function readSubtreeRunCapabilities(
  projectId: string,
): Promise<SubtreeRunCapabilityMap> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listSubtreeRunCapabilities(projectId),
    graphQl: async (execute) => {
      const bindings = (
        await execute(WorkTrackerWorkflowCatalogDocument, { projectId })
      ).launch_bindings;
      const capabilities: SubtreeRunCapabilityMap = {};
      for (const binding of bindings) {
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
      const [catalog, transitionResult, providerCatalog] = await Promise.all([
        execute(WorkTrackerWorkflowCatalogDocument, { projectId }),
        execute(WorkTrackerIssueTypeTransitionsDocument, { issueTypeId }),
        execute(LoadProviderCatalogDocument, {}),
      ]);
      const selectedType = catalog.issue_types.find(
        (candidate) => candidate.id === issueTypeId,
      );
      if (!selectedType) throw new Error("Work-item type not found.");
      return rest.assembleScopedWorkflowSettings(
        issueType(selectedType),
        catalog.states.map((state) => ({ ...state })),
        transitionResult.issue_type_transitions.map((transition) => ({
          ...transition,
        })),
        catalog.launch_bindings.map((binding) => ({
          ...binding,
          required_skills: [...binding.required_skills],
        })),
        catalog.providers.map((provider) => ({ ...provider })),
        catalog.agent_models.map((model) => ({
          ...model,
          permitted_reasoning_levels: [...model.permitted_reasoning_levels],
        })),
        catalog.reasoning_levels.map((level) => ({ ...level })),
        Boolean(providerCatalog.provider_catalog.global_default),
      );
    },
  });
}
