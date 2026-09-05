import { gql } from "@apollo/client";
import type { IssueType } from "../../../shared/api/types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";

export const WorkTrackerProjectIssueTypeMetadataDocument = gql`
  query WorkTrackerProjectIssueTypeMetadata($projectId: String!) {
    issue_types: worktrackerIssuetype(
      filters: { projectId: { eq: $projectId } }
      orderBy: { sortOrder: ASC, createdAt: ASC }
    ) {
      nodes {
        id
        project: projectId
        name
        level
        color
        sort_order: sortOrder
        start_state: startStateId
        workflow_revision: workflowRevision
      }
    }
  }
`;

export interface WorkTrackerProjectIssueTypeMetadataQuery {
  issue_types: {
    nodes: Array<{
      id: string;
      project: string;
      name: string;
      level: string;
      color: string;
      sort_order: number;
      start_state: string | null;
      workflow_revision: number;
    }>;
  };
}

/** Metadata edits must not copy optimistic relationships or invent empty ones. */
export function setIssueTypeMetadata(projectId: string, issueTypes: IssueType[]): void {
  const data = {
    issue_types: {
      __typename: "WorktrackerIssuetypeConnection",
      nodes: issueTypes.map((type, index) => ({
        __typename: "WorktrackerIssuetype",
        id: compactWorktrackerId(type.id),
        project: compactWorktrackerId(type.project ?? projectId),
        name: type.name,
        level: type.level,
        color: type.color ?? "",
        sort_order: type.sort_order ?? index,
        start_state: type.start_state ? compactWorktrackerId(type.start_state) : null,
        workflow_revision: type.workflow_revision ?? 0,
      })),
    },
  };
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectIssueTypeMetadataDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    data,
  });
}
