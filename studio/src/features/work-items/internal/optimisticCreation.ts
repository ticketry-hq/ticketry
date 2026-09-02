import type { ApolloCache } from "@apollo/client";

import type { WorkItemCreate } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import { WorkTrackerProjectOpenDocument } from "../../projects/generated/projects.documents";
import {
  WorkTrackerModuleOpenDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../generated/workItems.documents";
import { arrivalRank } from "../utilities/arrivalRank";

interface CreationMembership {
  projectId: string;
  moduleId: string;
}

let optimisticSequence = 0;

function sameId(left: string | null | undefined, right: string): boolean {
  return left !== null
    && left !== undefined
    && compactWorktrackerId(left) === compactWorktrackerId(right);
}

export function optimisticCreatedIssue(
  cache: ApolloCache,
  membership: CreationMembership,
  body: WorkItemCreate,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  const project = cache.readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(membership.projectId) },
    optimistic: true,
    returnPartialData: true,
  });
  const issueType = project?.issue_types?.nodes.find((candidate) =>
    body.issue_type_id && sameId(candidate.id, body.issue_type_id)
  );
  const destinationId = body.state_id
    ?? issueType?.start_state
    ?? project?.states?.nodes.find((state) => state.group === "backlog")?.id
    ?? null;
  const module = cache.readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId: compactWorktrackerId(membership.moduleId) },
    optimistic: true,
    returnPartialData: true,
  });
  const state = destinationId
    ? project?.states?.nodes.find((candidate) => sameId(candidate.id, destinationId))
    : undefined;
  const now = new Date().toISOString();
  const sequence = ++optimisticSequence;

  return {
    __typename: "WorktrackerIssue",
    id: `optimistic:${sequence}`,
    name: body.name ?? "",
    project_id: publicWorktrackerId(membership.projectId),
    sequence_id: -sequence,
    state_id: destinationId ? publicWorktrackerId(destinationId) : null,
    description: body.description ?? "",
    workspace_tab_order: [],
    parent_id: body.parent_id
      ? publicWorktrackerId(body.parent_id)
      : publicWorktrackerId(membership.moduleId),
    module_id: publicWorktrackerId(membership.moduleId),
    is_archived: false,
    created_at: now,
    updated_at: now,
    rank: arrivalRank(module?.work_items?.nodes ?? [], destinationId),
    issue_type_id: publicWorktrackerId(body.issue_type_id ?? ""),
    project: null,
    state_record: state ? {
      __typename: "WorktrackerState",
      id: publicWorktrackerId(state.id),
      name: state.name,
      group: state.group,
      color: state.color,
      sort_order: state.sort_order,
      is_protected: state.is_protected,
    } : null,
    issue_type_record: issueType ? {
      __typename: "WorktrackerIssuetype",
      id: publicWorktrackerId(issueType.id),
      name: issueType.name,
      level: issueType.level,
      color: issueType.color,
      sort_order: issueType.sort_order,
    } : null,
    children: { __typename: "WorktrackerIssueConnection", nodes: [] },
    blocked_by_edges: { __typename: "WorktrackerIssueBlockerConnection", nodes: [] },
    blocks_edges: { __typename: "WorktrackerIssueBlockerConnection", nodes: [] },
  } as GeneratedWorkTrackerWorkItemFieldsFragment;
}
