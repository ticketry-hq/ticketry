import { skipToken, useQuery } from "@apollo/client/react";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import { WorkTrackerProjectStatesDocument } from "../../projects";
import {
  WorkTrackerProjectIssueTypeMetadataDocument,
  type WorkTrackerProjectIssueTypeMetadataQuery,
} from "./issueTypeMetadata";

/**
 * Whether a project can hold stories: it needs at least one state and one
 * task-level issue type. `unknown` until the project's catalog is cached.
 */
export type ProjectWorkflowPresence = "unknown" | "present" | "missing";

/** Text shown wherever story work is unavailable because no workflow exists. */
export const NO_WORKFLOW_MESSAGE = "No workflow yet";

/** Reads the cached project catalog only; it never issues a request. */
export function useProjectWorkflowPresence(
  projectId: string | null,
): ProjectWorkflowPresence {
  const options = projectId
    ? {
        variables: { projectId: compactWorktrackerId(projectId) },
        client: studioApolloClient(),
        fetchPolicy: "cache-only" as const,
      }
    : skipToken;
  const states = useQuery(WorkTrackerProjectStatesDocument, options);
  const issueTypes = useQuery<WorkTrackerProjectIssueTypeMetadataQuery>(
    WorkTrackerProjectIssueTypeMetadataDocument,
    options,
  );
  if (!states.data || !issueTypes.data) return "unknown";
  const hasStates = states.data.states.nodes.length > 0;
  const hasTaskTypes = issueTypes.data.issue_types.nodes.some(
    (type) => type.level === "task",
  );
  return hasStates && hasTaskTypes ? "present" : "missing";
}
