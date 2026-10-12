import type { ApolloCache } from "@apollo/client";

import type { WorkItemCreateVariables } from "../types";
import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { WorkTrackerProjectOpenDocument } from "../../projects";
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
  body: WorkItemCreateVariables,
): GeneratedWorkTrackerWorkItemFieldsFragment {
  const project = cache.readQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: compactWorktrackerId(membership.projectId) },
    optimistic: true,
    returnPartialData: true,
  });
  const issueType = project?.issue_types?.nodes.find((candidate) =>
    body.issueTypeId && sameId(candidate.id, body.issueTypeId)
  );
  const destinationId = body.stateId
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
    project_id: compactWorktrackerId(membership.projectId),
    sequence_id: -sequence,
    state_id: destinationId ? compactWorktrackerId(destinationId) : null,
    state_revision: 1,
    description: body.description ?? "",
    workspace_tab_order: [],
    parent_id: body.parentId
      ? compactWorktrackerId(body.parentId)
      : compactWorktrackerId(membership.moduleId),
    module_id: compactWorktrackerId(membership.moduleId),
    sprint_id: null,
    is_archived: false,
    created_at: now,
    updated_at: now,
    rank: arrivalRank(module?.work_items?.nodes ?? [], destinationId),
    issue_type_id: compactWorktrackerId(body.issueTypeId ?? ""),
    project: null,
    state_record: state ? {
      __typename: "WorktrackerState",
      id: compactWorktrackerId(state.id),
      name: state.name,
      group: state.group,
      color: state.color,
      sort_order: state.sort_order,
      is_protected: state.is_protected,
    } : null,
    issue_type_record: issueType ? {
      __typename: "WorktrackerIssuetype",
      id: compactWorktrackerId(issueType.id),
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
