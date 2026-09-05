import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { setIssueTypes } from "../features/settings/queries";
import { optimisticCreatedIssue } from "../features/work-items/internal/optimisticCreation";
import { GeneratedWorkTrackerWorkItemFieldsFragmentDoc } from "../features/work-items/generated/workItems.documents";
import { StateConfigurationPanel } from "../features/workflows/StateConfigurationPanel";
import { issueType, normalizedCatalog } from "../features/workflows/queries/projectCatalog";
import { readWorkflowSettings } from "../features/workflows/queries/readTransport";
import { setWorkflowIssueTypes } from "../features/workflows/queries";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { WorkTrackerProjectOpenDocument, useStudioStore, type WorkTrackerProjectOpenQuery } from "../features/projects";
import { initializeStudioRuntime } from "../runtime";
import { createBrowserRuntime } from "../runtime/browserRuntime";
import { createDesktopRuntime } from "../runtime/desktopRuntime";
import { publicWorktrackerId } from "../shared/api/generatedWorktracker";
import { studioApolloClient } from "../shared/apollo/client";
import { ISSUE_TYPE_ID, PROJECT_ID, STATE_ID, workflowCatalog } from "./workflowConfigurationFixture";

const typeId = publicWorktrackerId(ISSUE_TYPE_ID);
const storyId = "77777777777777777777777777777777";

function catalog(): WorkTrackerProjectOpenQuery {
  const fixture = structuredClone(workflowCatalog) as unknown as WorkTrackerProjectOpenQuery;
  const reviewId = "88888888888888888888888888888888";
  fixture.states.nodes.push({ ...fixture.states.nodes[0], id: reviewId, name: "Review", sort_order: 1 });
  const implementation = fixture.issue_types.nodes[0];
  implementation.transitions.nodes = [{
    __typename: "WorktrackerIssuetypetransition", id: 12,
    issue_type: ISSUE_TYPE_ID, from_state: STATE_ID, to_state: reviewId,
    agent_allowed: true, handoff: false,
    fromState: { __typename: "WorktrackerState", id: STATE_ID, sort_order: 0 },
    toState: { __typename: "WorktrackerState", id: reviewId, sort_order: 1 },
  }];
  const story = structuredClone(implementation);
  story.id = storyId;
  story.name = "Story";
  story.launch_bindings.nodes[0].id = 2;
  story.launch_bindings.nodes[0].issue_type = storyId;
  story.transitions.nodes[0].id = 13;
  story.transitions.nodes[0].issue_type = storyId;
  fixture.issue_types.nodes.unshift(story);
  return fixture;
}

async function prepare(fixture: WorkTrackerProjectOpenQuery) {
  initializeStudioRuntime(await createDesktopRuntime({
    invoke: vi.fn().mockResolvedValue({
      serviceHealth: { state: "ready", service: "backend", message: null, logPointer: null },
      initialNotices: [],
    }),
    createGraphQlProxy: () => ({
      graphql_execute: vi.fn(async () => JSON.stringify({ data: fixture })),
      graphql_subscribe: vi.fn(), graphql_unsubscribe: vi.fn(),
    }),
  }));
  await readWorkflowSettings(PROJECT_ID, typeId);
  useStudioStore.setState({ selectedProjectId: PROJECT_ID });
  useWorkflowEditorStore.setState({
    projectId: PROJECT_ID,
    states: normalizedCatalog(fixture).states,
    loading: false,
    action: null,
    error: null,
    controlErrors: {},
  });
}

afterEach(() => initializeStudioRuntime(createBrowserRuntime({ environment: {} })));

it("[overhaul-246] keeps launch policy canonical through optimistic writes, reopening, and refresh", async () => {
  const fixture = catalog();
  await prepare(fixture);
  const cache = studioApolloClient().cache;
  const created = optimisticCreatedIssue(cache, {
    projectId: PROJECT_ID, moduleId: "module-probe",
  }, { name: "Implementation child", issue_type_id: typeId });
  cache.recordOptimisticTransaction((optimistic) => optimistic.writeFragment({
    fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
    fragmentName: "GeneratedWorkTrackerWorkItemFields",
    data: created,
  }), "pending-child");

  const types = fixture.issue_types.nodes.map(issueType);
  setWorkflowIssueTypes(PROJECT_ID, types);
  setIssueTypes(PROJECT_ID, types);
  cache.removeOptimistic("pending-child");
  await useWorkflowEditorStore.getState().loadWorkflows([publicWorktrackerId(storyId), typeId]);
  expect(useWorkflowEditorStore.getState().workflows[typeId].launch_bindings).toHaveLength(1);
  expect(useWorkflowEditorStore.getState().workflows[typeId].transitions).toHaveLength(1);

  const properties = { state: normalizedCatalog(fixture).states[0], onClose: vi.fn() };
  const first = render(<StateConfigurationPanel {...properties} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Implementation" }));
  expect(screen.getByLabelText("Prompt")).toHaveValue("Implement it.");
  expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-luna");
  expect(screen.getByRole("listitem", { name: "Outgoing Implement to Review" })).toBeInTheDocument();

  first.unmount();
  render(<StateConfigurationPanel {...properties} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Implementation" }));
  expect(screen.getByLabelText("Prompt")).toHaveValue("Implement it.");

  await act(async () => { await readWorkflowSettings(PROJECT_ID, typeId, "network-only"); });
  const updated = structuredClone(fixture);
  updated.issue_types.nodes[1].launch_bindings.nodes[0].prompt = "Updated implementation prompt";
  act(() => {
    studioApolloClient().writeQuery({
      query: WorkTrackerProjectOpenDocument,
      variables: { projectId: PROJECT_ID },
      data: updated,
    });
  });
  await waitFor(() => expect(screen.getByLabelText("Prompt"))
    .toHaveValue("Updated implementation prompt"));
  expect(useWorkflowEditorStore.getState().workflows[typeId].launch_bindings[0].prompt)
    .toBe("Updated implementation prompt");
});
