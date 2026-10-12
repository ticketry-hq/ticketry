import { afterEach, describe, expect, it } from "vitest";

import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  workflowCatalogAnswer,
  workflowIssueTypeRow,
} from "../../test/workflowCatalogFixture";
import { WorkTrackerProjectOpenDocument } from "../projects";
import {
  createIssueType,
  deleteIssueType,
  reorderIssueTypes,
  updateIssueType,
} from "./mutationTransport";
import { getWorkflowIssueTypesSnapshot } from "./queries";

afterEach(async () => resetStudioApolloClient());

const story = workflowIssueTypeRow("t1", "Story", 0);
const bug = workflowIssueTypeRow("t2", "Bug", 1);

function seedCatalog(...issueTypes: ReturnType<typeof workflowIssueTypeRow>[]) {
  studioApolloClient().writeQuery({
    query: WorkTrackerProjectOpenDocument,
    variables: { projectId: "p1" },
    data: workflowCatalogAnswer([], issueTypes),
  });
}

const issueTypeOnly = ({ transitions: _t, launch_bindings: _l, ...row }: ReturnType<typeof workflowIssueTypeRow>) => row;

const issueTypeNames = () => getWorkflowIssueTypesSnapshot("p1").map((type) => type.name);

describe("issue type create", () => {
  it("sends the same payload and refreshes the workflow catalog from the server", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(story);
    transport
      .answerNext("CreateWorkTrackerIssueType", { create_issue_type: issueTypeOnly(bug) })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([], [story, bug]));

    await expect(createIssueType("p1", { name: "Bug", level: "task", color: "#888888" }))
      .resolves.toEqual({
        id: "t2", project: "p1", name: "Bug", level: "task", color: "#888888",
        sort_order: 1, start_state: null, workflow_revision: 1,
      });

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerIssueType",
        variables: { projectId: "p1", name: "Bug", level: "task", color: "#888888" },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(issueTypeNames()).toEqual(["Story", "Bug"]);
  });
});

describe("issue type update", () => {
  it("sends the same patch and refreshes the catalog of the project the server returns", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(story, bug);
    const renamed = { ...story, name: "Feature", color: "#00ff00" };
    transport
      .answerNext("UpdateWorkTrackerIssueType", { update_issue_type: issueTypeOnly(renamed) })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([], [renamed, bug]));

    await expect(updateIssueType("t1", { name: "Feature", color: "#00ff00" }))
      .resolves.toMatchObject({ id: "t1", name: "Feature", color: "#00ff00" });

    expect(transport.requests).toEqual([
      {
        operationName: "UpdateWorkTrackerIssueType",
        variables: { id: "t1", name: "Feature", color: "#00ff00" },
      },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(issueTypeNames()).toEqual(["Feature", "Bug"]);
  });
});

describe("issue type delete", () => {
  it("forwards the reassignment, evicts the type and refreshes the catalog", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(story, bug);
    transport
      .answerNext("DeleteWorkTrackerIssueType", { delete_issue_type: true })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([], [story]));

    await expect(deleteIssueType("p1", "t2", "t1")).resolves.toBeUndefined();

    expect(transport.requests).toEqual([
      { operationName: "DeleteWorkTrackerIssueType", variables: { id: "t2", reassignTo: "t1" } },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(issueTypeNames()).toEqual(["Story"]);
    expect(studioApolloClient().cache.extract()).not.toHaveProperty(["WorktrackerIssuetype:t2"]);
  });
});

describe("issue type reorder", () => {
  it("sends the ordered ids and settles the catalog to the server's order", async () => {
    const transport = installScriptedGraphQlTransport();
    seedCatalog(story, bug);
    const reordered = [{ ...bug, sort_order: 0 }, { ...story, sort_order: 1 }];
    transport
      .answerNext("ReorderWorkTrackerIssueTypes", { reorder_issue_types: reordered.map(issueTypeOnly) })
      .answerNext("WorkTrackerProjectOpen", workflowCatalogAnswer([], reordered));

    await expect(reorderIssueTypes("p1", ["t2", "t1"])).resolves.toMatchObject([
      { id: "t2", sort_order: 0 },
      { id: "t1", sort_order: 1 },
    ]);

    expect(transport.requests).toEqual([
      { operationName: "ReorderWorkTrackerIssueTypes", variables: { projectId: "p1", orderedIds: ["t2", "t1"] } },
      { operationName: "WorkTrackerProjectOpen", variables: { projectId: "p1" } },
    ]);
    expect(issueTypeNames()).toEqual(["Bug", "Story"]);
  });
});
