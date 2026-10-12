import { afterEach, expect, it } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { StudioApolloProvider } from "../../shared/apollo/StudioApolloProvider";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { WorkTrackerProjectIssueTypesDocument } from "../projects";
import { issueTypeById, useIssueTypesQuery } from "./index";

const projectId = "11111111-1111-1111-1111-111111111111";
const typeId = "22222222-2222-2222-2222-222222222222";
const stateId = "33333333-3333-3333-3333-333333333333";
const compact = (id: string) => id.replace(/-/g, "");
const timestamp = "2026-10-12T10:00:00";

afterEach(async () => {
  cleanup();
  await resetStudioApolloClient();
});

it("exposes sorted public issue types and nested workflow values while retaining raw Apollo rows", async () => {
  const type = {
    __typename: "WorktrackerIssuetype", id: compact(typeId), project: compact(projectId),
    name: "Story", level: "task", color: "blue", sort_order: 1,
    start_state: compact(stateId), workflow_revision: 7, is_pathfind: false,
    created_at: timestamp, updated_at: timestamp,
    transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: [{
      __typename: "WorktrackerIssuetypetransition",
      id: 1, issue_type: compact(typeId), from_state: compact(stateId), to_state: compact(stateId),
      agent_allowed: true, handoff: false,
      fromState: { __typename: "WorktrackerState", id: compact(stateId), sort_order: 0 }, toState: { __typename: "WorktrackerState", id: compact(stateId), sort_order: 0 },
    }] },
    launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: [{
      __typename: "WorktrackerLaunchbinding",
      id: 2, issue_type: compact(typeId), state: compact(stateId), prompt: "Implement",
      required_skills: [], stage_skills: [], profile: null, model: null, reasoning: null,
      auto_start: false, subtree_run_enabled: true, created_at: timestamp, updated_at: timestamp,
      state_record: { __typename: "WorktrackerState", id: compact(stateId), sort_order: 0 },
    }] },
  };
  const data = { __typename: "Query", issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [
    type, { ...type, id: "44444444444444444444444444444444", name: "Implementation", sort_order: 0 },
  ] } };
  const client = studioApolloClient();
  const options = { query: WorkTrackerProjectIssueTypesDocument, variables: { projectId: compact(projectId) } };
  client.writeQuery({ ...options, data });
  expect(client.readQuery(options)?.issue_types.nodes).toEqual(data.issue_types.nodes);
  const { result } = renderHook(() => useIssueTypesQuery(projectId), { wrapper: StudioApolloProvider });
  await waitFor(() => expect(result.current.data).toHaveLength(2));

  expect(result.current.data?.map(row => row.id)).toEqual([
    "44444444-4444-4444-4444-444444444444", typeId,
  ]);
  expect(issueTypeById(result.current.data!, typeId)).toMatchObject({
    id: typeId, project: projectId, start_state: stateId, workflow_revision: 7,
    created_at: `${timestamp}Z`, updated_at: `${timestamp}Z`,
    transitions: { nodes: [{ issue_type: typeId, from_state: stateId, to_state: stateId,
      fromState: { id: stateId }, toState: { id: stateId } }] },
    launch_bindings: { nodes: [{ issue_type: typeId, state: stateId, state_record: { id: stateId },
      created_at: `${timestamp}Z`, updated_at: `${timestamp}Z` }] },
  });
  expect(client.readQuery(options)?.issue_types.nodes).toEqual(data.issue_types.nodes);
});

it("skips issue types when no project is selected", () => {
  const { result } = renderHook(() => useIssueTypesQuery(null), { wrapper: StudioApolloProvider });
  expect(result.current.data).toBeUndefined();
});
