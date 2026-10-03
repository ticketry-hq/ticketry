import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { describe, expect, it } from "vitest";

import { PlanningGraphDocument, type PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import { createIssueRevisionGuardLink } from "../shared/apollo/issueRevisionGuardLink";
import { typePolicies } from "../shared/apollo/typePolicies";

type PlanningRow = PlanningGraphQuery["workItems"]["nodes"][number] & {
  __typename: "WorktrackerIssue";
  issueType: { __typename: "WorktrackerIssuetype"; id: string; name: string };
};

function graph(row: PlanningRow): PlanningGraphQuery {
  const data = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [row] },
  };
  return data;
}

const initialRow = {
  __typename: "WorktrackerIssue",
  id: "planning-story",
  name: "Old title",
  sequenceId: 42,
  rank: "V",
  parentId: null,
  moduleId: "old-epic",
  stateId: "todo",
  stateRevision: 1,
  sprintId: "old-sprint",
  updatedAt: "2026-10-01 00:00:00",
  issueType: { __typename: "WorktrackerIssuetype", id: "story-type", name: "Story" },
} satisfies PlanningRow;

const editedRow = {
  ...initialRow,
  name: "Edited title",
  moduleId: "next-epic",
  stateId: "in-progress",
  stateRevision: 2,
  sprintId: "next-sprint",
  updatedAt: "2026-10-02 00:00:00",
} satisfies PlanningRow;

async function deliverAfterEdit(incoming: PlanningRow) {
  const cache = new InMemoryCache({ typePolicies });
  const variables = { projectId: "planning-project" };
  cache.writeQuery({ query: PlanningGraphDocument, variables, data: graph(initialRow) });
  let deliver: () => void = () => { throw new Error("PlanningGraph request has not started"); };
  let requestStarted = () => {};
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const responseLink = new ApolloLink(() => new Observable((observer) => {
    deliver = () => {
      observer.next({ data: graph(incoming) });
      observer.complete();
    };
    requestStarted();
  }));
  const client = new ApolloClient({
    cache,
    link: ApolloLink.from([createIssueRevisionGuardLink(cache), responseLink]),
  });
  try {
    const pending = client.query({ query: PlanningGraphDocument, variables, fetchPolicy: "network-only" });
    await started;
    cache.writeQuery({ query: PlanningGraphDocument, variables, data: graph(editedRow) });
    deliver();
    const result = await pending;
    return {
      delivered: result.data?.workItems?.nodes?.[0],
      cached: client.readQuery({ query: PlanningGraphDocument, variables })?.workItems?.nodes?.[0],
    };
  } finally {
    client.stop();
  }
}

describe("PlanningGraph delayed responses", () => {
  it("preserves newer sprint and epic membership, workflow state and title", async () => {
    const result = await deliverAfterEdit(initialRow);
    for (const row of [result.delivered, result.cached]) {
      expect(row).toMatchObject({
        name: "Edited title",
        moduleId: "next-epic",
        stateId: "in-progress",
        stateRevision: 2,
        sprintId: "next-sprint",
        updatedAt: "2026-10-02 00:00:00",
      });
    }
  });

  it.each([2, 3])("converges to a delayed response at revision %i", async (stateRevision) => {
    const incoming = {
      ...editedRow,
      name: "Server title",
      moduleId: "server-epic",
      stateId: "done",
      stateRevision,
      sprintId: "server-sprint",
      updatedAt: "2026-10-03 00:00:00",
    } satisfies PlanningRow;
    const result = await deliverAfterEdit(incoming);
    for (const row of [result.delivered, result.cached]) {
      expect(row).toMatchObject({
        name: "Server title",
        moduleId: "server-epic",
        stateId: "done",
        stateRevision,
        sprintId: "server-sprint",
        updatedAt: "2026-10-03 00:00:00",
      });
    }
  });
});
