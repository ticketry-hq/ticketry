import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from "@apollo/client";
import { describe, expect, it } from "vitest";

import { createIssueRevisionGuardLink } from "./issueRevisionGuardLink";
import { typePolicies } from "./typePolicies";

/** Rows travel through an aliased fragment, as the Studio operations do. */
const issueQuery = gql`
  fragment RevisionGuardIssue on WorktrackerIssue {
    id
    name
    description
    state_revision: stateRevision
  }
  query RevisionGuardIssues {
    worktrackerIssue {
      nodes { ...RevisionGuardIssue }
    }
  }
`;

const cacheFragment = gql`
  fragment RevisionGuardCached on WorktrackerIssue {
    id
    name
    description
    stateRevision
  }
`;

const ID = 'WorktrackerIssue:{"id":"issue-1091"}';

function snapshot(stateRevision: number, name = `revision-${stateRevision}`) {
  return {
    __typename: "WorktrackerIssue",
    id: "issue-1091",
    name,
    description: `description-${stateRevision}`,
    state_revision: stateRevision,
  } as const;
}

function clientWith(cache: InMemoryCache, incoming: ReturnType<typeof snapshot>) {
  const responseLink = new ApolloLink(() => new Observable((observer) => {
    observer.next({
      data: {
        worktrackerIssue: {
          __typename: "WorktrackerIssueConnection",
          nodes: [incoming],
        },
      },
    });
    observer.complete();
  }));
  return new ApolloClient({
    cache,
    link: ApolloLink.from([createIssueRevisionGuardLink(cache), responseLink]),
  });
}

function cacheWith(existing: ReturnType<typeof snapshot>) {
  const cache = new InMemoryCache({ typePolicies });
  cache.writeFragment({
    id: ID,
    fragment: cacheFragment,
    data: { ...existing, stateRevision: existing.state_revision },
  });
  return cache;
}

type IssueQueryResult = {
  worktrackerIssue: {
    nodes: Array<ReturnType<typeof snapshot>>;
  };
};

const query = (client: ApolloClient) =>
  client.query<IssueQueryResult>({ query: issueQuery, fetchPolicy: "network-only" });

describe("Work Item revision guard link", () => {
  it("keeps the cached Work Item when a stale network snapshot arrives", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await query(clientWith(cache, snapshot(6, "stale")));

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject(snapshot(7));
    expect(cache.readFragment({ id: ID, fragment: cacheFragment })).toMatchObject({
      name: "revision-7",
      description: "description-7",
      stateRevision: 7,
    });
  });

  it("accepts a network snapshot at the same revision", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await query(clientWith(cache, snapshot(7, "equal-update")));

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject({
      name: "equal-update",
      state_revision: 7,
    });
  });

  it("accepts a newer network snapshot", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await query(clientWith(cache, snapshot(8)));

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject(snapshot(8));
  });

  it("compares against the base layer, never an optimistic row", async () => {
    const cache = cacheWith(snapshot(7));
    cache.recordOptimisticTransaction((optimistic) => {
      optimistic.writeFragment({
        id: ID,
        fragment: cacheFragment,
        data: { ...snapshot(9, "optimistic"), stateRevision: 9 },
      });
    }, "mutation-1");

    await query(clientWith(cache, snapshot(8, "server")));

    // Revision 8 is below the optimistic 9 but above the base 7: it is written.
    expect(cache.readFragment({ id: ID, fragment: cacheFragment, optimistic: false })).toMatchObject({
      name: "server",
      stateRevision: 8,
    });
  });
});
