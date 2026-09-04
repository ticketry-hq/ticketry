import { ApolloClient, ApolloLink, gql, InMemoryCache, Observable } from "@apollo/client";
import { print } from "graphql";
import { describe, expect, it } from "vitest";

import {
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
} from "../../features/work-items/generated/workItems.documents";
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

function productionSnapshot(
  stateRevision: number,
  name: string,
  stateId: string,
  includesStateRevision: boolean,
) {
  return {
    __typename: "WorktrackerIssue",
    id: "issue-production",
    name,
    project_id: "project-1",
    sequence_id: 1168,
    state_id: stateId,
    description: "Production document regression fixture",
    parent_id: null,
    module_id: "module-1",
    is_archived: false,
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
    rank: "1",
    issue_type_id: "issue-type-1",
    project: {
      __typename: "WorktrackerProject",
      id: "project-1",
      slug: "CODING",
    },
    state_record: {
      __typename: "WorktrackerState",
      id: stateId,
      name: stateId,
      group: "started",
      color: "",
      sort_order: 1,
      is_protected: false,
    },
    issue_type_record: {
      __typename: "WorktrackerIssuetype",
      id: "issue-type-1",
      name: "Implementation",
      level: "task",
      color: "",
      sort_order: 1,
    },
    children: {
      __typename: "WorktrackerIssueConnection",
      nodes: [],
    },
    blocked_by_edges: {
      __typename: "WorktrackerIssueBlockedByConnection",
      nodes: [],
    },
    blocks_edges: {
      __typename: "WorktrackerIssueBlockedByConnection",
      nodes: [],
    },
    ...(includesStateRevision ? { stateRevision } : {}),
  } as const;
}

type IssueQueryResult = {
  worktrackerIssue: {
    nodes: Array<ReturnType<typeof snapshot>>;
  };
};

describe("Work Item revision guard link", () => {
  it("keeps a newer module snapshot when the real detail document returns stale aliases", async () => {
    const cache = new InMemoryCache({ typePolicies });
    const responseLink = new ApolloLink((operation) => new Observable((observer) => {
      const includesStateRevision = print(operation.query).includes("stateRevision");
      const issue = operation.operationName === "WorkTrackerModuleOpen"
        ? productionSnapshot(7, "newer", "state-newer", includesStateRevision)
        : productionSnapshot(6, "stale", "state-stale", includesStateRevision);
      observer.next({
        data: operation.operationName === "WorkTrackerModuleOpen"
          ? {
            module: { __typename: "WorktrackerIssueConnection", nodes: [] },
            work_items: { __typename: "WorktrackerIssueConnection", nodes: [issue] },
          }
          : {
            work_item: { __typename: "WorktrackerIssueConnection", nodes: [issue] },
          },
      });
      observer.complete();
    }));
    const client = new ApolloClient({
      cache,
      link: ApolloLink.from([createIssueRevisionGuardLink(cache), responseLink]),
    });

    await client.query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
      fetchPolicy: "network-only",
    });
    await client.query({
      query: WorkTrackerWorkItemDocument,
      variables: { id: "issue-production" },
      fetchPolicy: "network-only",
    });

    const cached = cache.readQuery({
      query: WorkTrackerWorkItemDocument,
      variables: { id: "issue-production" },
    });
    expect(cached?.work_item.nodes[0]).toMatchObject({
      name: "newer",
      state_id: "state-newer",
    });
  });

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
