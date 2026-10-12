import { afterEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  workflowCatalogAnswer,
  workflowIssueTypeRow,
  workflowIssueTypeWith,
  workflowLaunchBindingRow,
  workflowStateRow,
} from "../../test/workflowCatalogFixture";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { getCapabilitiesSnapshot } from "../settings";
import { useWorkflowEditorStore } from "./workflowEditorStore";

afterEach(async () => resetStudioApolloClient());

const todo = workflowStateRow("s1", "Todo", 0);
const review = workflowStateRow("s2", "Review", 1, "started");
const story = workflowIssueTypeWith(workflowIssueTypeRow("t1", "Story", 0), {
  startState: "s1",
  workflowRevision: 3,
});
const catalog = (issueType: typeof story) => workflowCatalogAnswer([todo, review], [issueType]);

/** The editor open on project p1 with story's workflow at revision 3 already read. */
function openEditor(issueType = story) {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
    data: catalog(issueType),
  });
  useWorkflowEditorStore.setState({
    projectId: "p1",
    selectedTypeId: "t1",
    action: null,
    notice: null,
    error: null,
    controlErrors: {},
  });
  return useWorkflowEditorStore;
}

describe("workflow editor: per-type workflow writes", () => {
  it("applies at the editor's revision and shows the declared refresh without a second read", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor();
    transport
      .answerNext("SetWorkTrackerStartState", {
        update_issue_type: { __typename: "WorktrackerIssuetype", id: "t1", workflow_revision: 4 },
      })
      .answerNext("WorkTrackerProjectOpen", catalog(workflowIssueTypeWith(story, {
        startState: "s2",
        workflowRevision: 4,
      })));

    await editor.getState().setStartState("t1", "s2", "start");

    expect(transport.requests).toEqual([
      {
        operationName: "SetWorkTrackerStartState",
        variables: { id: "t1", startStateId: "s2", workflowRevision: 3 },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(editor.getState().workflows.t1).toMatchObject({
      start_state_id: "s2",
      workflow_revision: 4,
    });
    expect(editor.getState()).toMatchObject({
      action: null,
      notice: null,
      controlErrors: { start: "" },
    });
  });

  it("loads the latest settings and shows the conflict notice when the revision is stale", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor();
    transport
      .failNext("SetWorkTrackerStartState", "stale_revision", "Workflow revision is stale")
      .answerNext("WorkTrackerProjectOpen", catalog(workflowIssueTypeWith(story, {
        workflowRevision: 5,
      })));

    await editor.getState().setStartState("t1", "s2", "start");

    expect(transport.operationNames()).toEqual([
      "SetWorkTrackerStartState",
      "WorkTrackerProjectOpen",
    ]);
    expect(editor.getState().workflows.t1.workflow_revision).toBe(5);
    expect(editor.getState()).toMatchObject({
      action: null,
      error: null,
      notice: "Workflow changed elsewhere. Latest settings loaded.",
      controlErrors: { start: "" },
    });
  });

  it("shows any other failure on the control and reads nothing", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor();
    transport.failNext("SetWorkTrackerStartState", "not_found", "State not found");

    await editor.getState().setStartState("t1", "s2", "start");

    expect(transport.operationNames()).toEqual(["SetWorkTrackerStartState"]);
    expect(editor.getState()).toMatchObject({
      action: null,
      notice: null,
      controlErrors: { start: "State not found" },
    });
  });

  it("synchronizes the subtree-run capability from the refreshed workflow", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(workflowIssueTypeWith(story, {
      launchBindings: [workflowLaunchBindingRow(1, "t1", "s2")],
    }));
    transport
      .answerNext("SetWorkTrackerSubtreeRun", {
        upsert_issue_type_launch_binding: { __typename: "WorktrackerLaunchbinding", id: 1 },
      })
      .answerNext("WorkTrackerProjectOpen", catalog(workflowIssueTypeWith(story, {
        workflowRevision: 4,
        launchBindings: [workflowLaunchBindingRow(1, "t1", "s2", { subtree_run_enabled: true })],
      })));

    await editor.getState().setSubtreeRun("t1", "s2", true, "subtree");

    expect(transport.requests).toEqual([
      {
        operationName: "SetWorkTrackerSubtreeRun",
        variables: { issueTypeId: "t1", stateId: "s2", workflowRevision: 3, enabled: true },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(getCapabilitiesSnapshot("p1")).toEqual({ t1: ["s2"] });
    expect(editor.getState().workflows.t1.launch_bindings[0].subtree_run_enabled).toBe(true);
  });
});
