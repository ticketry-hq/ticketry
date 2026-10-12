import { afterEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { stateCatalogRevision } from "../../shared/stateCatalogRevision";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  projectItemsAnswer,
  workflowCatalogAnswer,
  workflowIssueTypeRow,
  workflowStateRow,
} from "../../test/workflowCatalogFixture";
import { WorkTrackerProjectOpenDocument } from "../projects";
import { useWorkflowEditorStore } from "./workflowEditorStore";

afterEach(async () => resetStudioApolloClient());

const todo = workflowStateRow("s1", "Todo", 0);
const review = workflowStateRow("s2", "Review", 1, "started");
const story = workflowIssueTypeRow("t1", "Story", 0);

/** The editor open on project p1 with this catalog already read. */
function openEditor(...states: ReturnType<typeof workflowStateRow>[]) {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
    data: workflowCatalogAnswer(states, [story]),
  });
  useWorkflowEditorStore.setState({ projectId: "p1" });
  return useWorkflowEditorStore;
}

const stateNames = () => useWorkflowEditorStore.getState().states.map((state) => state.name);

describe("workflow editor: delete state", () => {
  it("sends no reassignment and reloads only through the declared refreshes", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo, review);
    transport
      .answerNext("DeleteWorkTrackerState", { delete_state: true })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([todo], [story]))
      .answerNext("WorkTrackerWorkItems", projectItemsAnswer(["s1", "s1"]));

    await editor.getState().removeState({ stateId: "s2", stateName: "Review" });

    expect(transport.requests[0]).toEqual({
      operationName: "DeleteWorkTrackerState",
      variables: { id: "s2" },
    });
    expect(transport.operationNames().slice(1).sort()).toEqual([
      "WorkTrackerProjectOpen",
      "WorkTrackerWorkItems",
    ]);
    expect(stateNames()).toEqual(["Todo"]);
    expect(editor.getState().stateWorkItemCounts).toEqual({ s1: 2 });
    expect(editor.getState()).toMatchObject({
      action: null,
      notice: "State Review deleted.",
      error: null,
    });
  });
});

describe("workflow editor: create and update state", () => {
  it("shows the created state with its notice and advances the state-catalog revision", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo);
    const revision = stateCatalogRevision("p1");
    transport
      .answerNext("CreateWorkTrackerState", { create_state: review })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([todo, review], [story]));

    await editor.getState().createState("Review", "started");

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerState",
        variables: { projectId: "p1", name: "Review", group: "started" },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(stateNames()).toEqual(["Todo", "Review"]);
    expect(stateCatalogRevision("p1")).toBe(revision + 1);
    expect(editor.getState()).toMatchObject({
      action: null,
      notice: "State Review created.",
      error: null,
    });
  });

  it("shows the updated state with its notice", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo, review);
    const ready = { ...todo, name: "Ready" };
    transport
      .answerNext("UpdateWorkTrackerState", { update_state: ready })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([ready, review], [story]));

    await editor.getState().updateState("s1", { name: "Ready" });

    expect(transport.operationNames()).toEqual(["UpdateWorkTrackerState", "WorkTrackerProjectOpen"]);
    expect(stateNames()).toEqual(["Ready", "Review"]);
    expect(editor.getState()).toMatchObject({ action: null, notice: "State Ready updated." });
  });

  it("leaves the editor alone when the project changed while the write was in flight", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo);
    const held = transport.holdNext("CreateWorkTrackerState");
    transport.answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([todo, review], [story]));

    const creating = editor.getState().createState("Review", "started");
    await held.reached;
    editor.setState({ projectId: "p2", action: null, notice: null });
    held.answer({ create_state: review });
    await creating;

    expect(editor.getState()).toMatchObject({ projectId: "p2", action: null, notice: null, error: null });
  });
});

describe("workflow editor: reorder states", () => {
  it("shows the new order at once and settles to the server's order", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo, review);
    const held = transport.holdNext("ReorderWorkTrackerStates");
    const reordered = [{ ...review, sort_order: 0 }, { ...todo, sort_order: 1 }];
    transport.answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer(reordered, [story]));

    const moving = editor.getState().reorderState("s2", "s1");
    await held.reached;
    expect(stateNames()).toEqual(["Review", "Todo"]);
    expect(editor.getState().action).toBe("reorder");
    held.answer({ reorder_states: reordered });
    await moving;

    expect(transport.requests).toEqual([
      { operationName: "ReorderWorkTrackerStates", variables: { projectId: "p1", orderedIds: ["s2", "s1"] } },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(stateNames()).toEqual(["Review", "Todo"]);
    expect(editor.getState()).toMatchObject({ action: null, error: null });
  });

  it("rolls the optimistic order back and shows the error when the reorder fails", async () => {
    const transport = installScriptedGraphQlTransport();
    const editor = openEditor(todo, review);
    const held = transport.holdNext("ReorderWorkTrackerStates");

    const moving = editor.getState().moveState("s1", 1);
    await held.reached;
    expect(stateNames()).toEqual(["Review", "Todo"]);
    held.fail("conflict", "States changed elsewhere");
    await moving;

    expect(transport.operationNames()).toEqual(["ReorderWorkTrackerStates"]);
    expect(stateNames()).toEqual(["Todo", "Review"]);
    expect(editor.getState()).toMatchObject({ action: null, error: "States changed elsewhere" });
  });
});
