import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  projectItemsAnswer,
  workflowCatalogAnswer,
  workflowStateRow,
} from "../../test/workflowCatalogFixture";
import { getStatesSnapshot, WorkTrackerProjectOpenDocument } from "../projects";
import { createState, deleteState, reorderStates, updateState } from "./mutationTransport";

afterEach(async () => resetStudioApolloClient());

const todo = workflowStateRow("s1", "Todo", 0);
const review = workflowStateRow("s2", "Review", 1, "started");

function seedCatalog(...states: ReturnType<typeof workflowStateRow>[]) {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
    data: workflowCatalogAnswer(states),
  });
}

describe("state create", () => {
  it("sends the same payload and refreshes the workflow catalog from the server", async () => {
    const transport = installScriptedGraphQlTransport();
    transport
      .answerNext("CreateWorkTrackerState", { create_state: review })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([todo, review]));

    await expect(createState("p1", { name: "Review", group: "started" }))
      .resolves.toMatchObject({ id: "s2", name: "Review", group: "started" });

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerState",
        variables: { projectId: "p1", name: "Review", group: "started" },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(getStatesSnapshot("p1").map((state) => state.name)).toEqual(["Todo", "Review"]);
  });
});

describe("state update", () => {
  it("sends the same patch and refreshes the catalog of the project the server returns", async () => {
    const transport = installScriptedGraphQlTransport();
    const renamed = { ...todo, name: "Ready", color: "#00ff00" };
    transport
      .answerNext("UpdateWorkTrackerState", { update_state: renamed })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([renamed, review]));

    await expect(updateState("s1", { name: "Ready", color: "#00ff00" }))
      .resolves.toMatchObject({ id: "s1", name: "Ready" });

    expect(transport.requests).toEqual([
      {
        operationName: "UpdateWorkTrackerState",
        variables: { id: "s1", name: "Ready", color: "#00ff00" },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(getStatesSnapshot("p1").map((state) => state.name)).toEqual(["Ready", "Review"]);
  });
});

describe("state delete", () => {
  it("sends no reassignment, evicts the state and refreshes the catalog and the project's items", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(todo, review);
    transport
      .answerNext("DeleteWorkTrackerState", { delete_state: true })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([todo]))
      .answerNext("WorkTrackerWorkItems", projectItemsAnswer(["s1"]));

    await expect(deleteState("p1", "s2", "s1")).resolves.toBeUndefined();

    expect(transport.requests[0]).toEqual({
      operationName: "DeleteWorkTrackerState",
      variables: { id: "s2" },
    });
    expect(transport.requests.slice(1)).toEqual(expect.arrayContaining([
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
      { operationName: "WorkTrackerWorkItems", variables: { projectId: "p1" } },
    ]));
    expect(transport.requests).toHaveLength(3);
    expect(getStatesSnapshot("p1").map((state) => state.name)).toEqual(["Todo"]);
    expect(studioApolloClient().cache.extract()).not.toHaveProperty(["WorktrackerState:s2"]);
  });
});

describe("state reorder", () => {
  it("sends the ordered ids and settles the catalog to the server's order", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(todo, review);
    const reordered = [{ ...review, sort_order: 0 }, { ...todo, sort_order: 1 }];
    transport
      .answerNext("ReorderWorkTrackerStates", { reorder_states: reordered })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer(reordered));

    await expect(reorderStates("p1", ["s2", "s1"])).resolves.toMatchObject([
      { id: "s2", sort_order: 0 },
      { id: "s1", sort_order: 1 },
    ]);

    expect(transport.requests).toEqual([
      { operationName: "ReorderWorkTrackerStates", variables: { projectId: "p1", orderedIds: ["s2", "s1"] } },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(getStatesSnapshot("p1").map((state) => state.name)).toEqual(["Review", "Todo"]);
  });

  it("surfaces a domain failure as the same ApiError and refreshes nothing", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(todo, review);
    transport.failNext("ReorderWorkTrackerStates", "validation", "Ordered ids must list every state");

    const failure = await reorderStates("p1", ["s2"]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 422,
      message: "Ordered ids must list every state",
      body: { code: "validation", detail: "Ordered ids must list every state" },
    });
    expect(transport.operationNames()).toEqual(["ReorderWorkTrackerStates"]);
    expect(getStatesSnapshot("p1").map((state) => state.name)).toEqual(["Todo", "Review"]);
  });
});
