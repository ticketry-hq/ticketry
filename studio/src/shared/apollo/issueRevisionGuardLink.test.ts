import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from "@apollo/client";
import { describe, expect, it } from "vitest";

import { createIssueRevisionGuardLink } from "./issueRevisionGuardLink";
import { typePolicies } from "./typePolicies";

const issueFragment = gql`
  fragment RevisionGuardIssue on WorktrackerIssue {
    id
    name
    description
    stateRevision
  }
`;

const issueQuery = gql`
  query RevisionGuardIssues {
    worktrackerIssue {
      nodes {
        id
        name
        description
        stateRevision
      }
    }
  }
`;

function snapshot(stateRevision: number, name = `revision-${stateRevision}`) {
  return {
    __typename: "WorktrackerIssue",
    id: "issue-1091",
    name,
    description: `description-${stateRevision}`,
    stateRevision,
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
    id: cache.identify(existing),
    fragment: issueFragment,
    data: existing,
  });
  return cache;
}

type IssueQueryResult = {
  worktrackerIssue: {
    nodes: Array<ReturnType<typeof snapshot>>;
  };
};

describe("Work Item revision guard link", () => {
  it("keeps the cached Work Item when a stale network snapshot arrives", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await clientWith(cache, snapshot(6, "stale")).query<IssueQueryResult>({
      query: issueQuery,
      fetchPolicy: "network-only",
    });

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject(snapshot(7));
    expect(cache.readFragment({
      id: 'WorktrackerIssue:{"id":"issue-1091"}',
      fragment: issueFragment,
    })).toMatchObject(snapshot(7));
  });

  it("accepts a network snapshot at the same revision", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await clientWith(cache, snapshot(7, "equal-update")).query<IssueQueryResult>({
      query: issueQuery,
      fetchPolicy: "network-only",
    });

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject({
      name: "equal-update",
      stateRevision: 7,
    });
  });

  it("accepts a newer network snapshot", async () => {
    const cache = cacheWith(snapshot(7));
    const result = await clientWith(cache, snapshot(8)).query<IssueQueryResult>({
      query: issueQuery,
      fetchPolicy: "network-only",
    });

    expect(result.data!.worktrackerIssue.nodes[0]).toMatchObject(snapshot(8));
  });
});
