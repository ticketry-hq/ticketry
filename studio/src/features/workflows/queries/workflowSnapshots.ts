import { skipToken, useQuery } from "@apollo/client/react";
import { compactWorktrackerId, publicWorktrackerId } from "../../../shared/api/generatedWorktracker";
import type { ScopedWorkflowSettings } from "../../../shared/api/types";
import { studioApolloClient } from "../../../shared/apollo/client";
import { WorkTrackerProjectOpenDocument, type WorkTrackerProjectOpenQuery } from "../../projects";
import { normalizedCatalog } from "./projectCatalog";
import { workflowSettingsFromCatalog } from "./readTransport";

type Workflows = Record<string, ScopedWorkflowSettings>;
const EMPTY_WORKFLOWS: Workflows = {};
// Memoize a projection of Apollo's immutable result, never a separate saved copy.
const projections = new WeakMap<WorkTrackerProjectOpenQuery, Workflows>();

export function getProjectWorkflowSettingsSnapshot(projectId: string): Workflows {
  const data = studioApolloClient().readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    optimistic: true,
  });
  return projectWorkflows(data);
}

function projectWorkflows(data: WorkTrackerProjectOpenQuery | null | undefined): Workflows {
  if (!data) return EMPTY_WORKFLOWS;
  const existing = projections.get(data);
  if (existing) return existing;
  const catalog = normalizedCatalog(data);
  const workflows = Object.fromEntries(catalog.issueTypes.map((type) => {
    const id = publicWorktrackerId(type.id);
    return [id, workflowSettingsFromCatalog(catalog, id)];
  }));
  projections.set(data, workflows);
  return workflows;
}

export function useProjectWorkflowSettings(projectId: string | null): Workflows {
  const { data } = useQuery(WorkTrackerProjectOpenDocument, projectId ? {
    client: studioApolloClient(),
    variables: { projectId: compactWorktrackerId(projectId) },
    fetchPolicy: "cache-and-network",
  } : skipToken);
  return projectWorkflows(data);
}
