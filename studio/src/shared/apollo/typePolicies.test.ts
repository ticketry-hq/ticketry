import { gql, InMemoryCache } from "@apollo/client";
import { describe, expect, it } from "vitest";

import { typePolicies } from "./typePolicies";

describe("Apollo normalized entity identities", () => {
  it("uses schema identities for shared server entities", () => {
    const cache = new InMemoryCache({ typePolicies });

    expect({
      issue: cache.identify({ __typename: "WorktrackerIssue", id: "issue-1" }),
      state: cache.identify({ __typename: "WorktrackerState", id: "state-1" }),
      issueType: cache.identify({ __typename: "WorktrackerIssuetype", id: "type-1" }),
      transition: cache.identify({ __typename: "WorktrackerIssuetypetransition", id: 1 }),
      launchBinding: cache.identify({ __typename: "WorktrackerLaunchbinding", id: 2 }),
      provider: cache.identify({ __typename: "WorktrackerProvider", id: "codex" }),
      agentModel: cache.identify({ __typename: "WorktrackerAgentmodel", id: "gpt" }),
      reasoning: cache.identify({ __typename: "WorktrackerReasoninglevel", id: "high" }),
      agentRun: cache.identify({ __typename: "AgentRuns", id: "run-1" }),
      graphRun: cache.identify({ __typename: "GraphRuns", rootId: "story-1" }),
      terminal: cache.identify({ __typename: "AgentTerminalSessions", agentRunId: "run-1" }),
      worktree: cache.identify({ __typename: "Worktrees", id: "tree-1" }),
      document: cache.identify({ __typename: "DesignDocuments", id: "doc-1" }),
    }).toEqual({
      issue: 'WorktrackerIssue:{"id":"issue-1"}',
      state: 'WorktrackerState:{"id":"state-1"}',
      issueType: 'WorktrackerIssuetype:{"id":"type-1"}',
      transition: 'WorktrackerIssuetypetransition:{"id":1}',
      launchBinding: 'WorktrackerLaunchbinding:{"id":2}',
      provider: 'WorktrackerProvider:{"id":"codex"}',
      agentModel: 'WorktrackerAgentmodel:{"id":"gpt"}',
      reasoning: 'WorktrackerReasoninglevel:{"id":"high"}',
      agentRun: 'AgentRuns:{"id":"run-1"}',
      graphRun: 'GraphRuns:{"rootId":"story-1"}',
      terminal: 'AgentTerminalSessions:{"agentRunId":"run-1"}',
      worktree: 'Worktrees:{"id":"tree-1"}',
      document: 'DesignDocuments:{"id":"doc-1"}',
    });
  });

  it("replaces Seaography connection wrappers instead of normalizing them", () => {
    const cache = new InMemoryCache({ typePolicies });
    const query = gql`
      query ConnectionReplacementProbe {
        worktrackerIssue {
          nodes { id name }
        }
      }
    `;

    cache.writeQuery({
      query,
      data: {
        worktrackerIssue: {
          __typename: "WorktrackerIssueConnection",
          nodes: [{ __typename: "WorktrackerIssue", id: "issue-1", name: "first" }],
        },
      },
    });
    cache.writeQuery({
      query,
      data: {
        worktrackerIssue: {
          __typename: "WorktrackerIssueConnection",
          nodes: [{ __typename: "WorktrackerIssue", id: "issue-2", name: "second" }],
        },
      },
    });

    expect(cache.extract()).toMatchObject({
      ROOT_QUERY: {
        worktrackerIssue: {
          __typename: "WorktrackerIssueConnection",
          nodes: [{ __ref: 'WorktrackerIssue:{"id":"issue-2"}' }],
        },
      },
    });
  });

  it("garbage-collects rows evicted when the active project changes", () => {
    const cache = new InMemoryCache({ typePolicies });
    const query = gql`
      query ProjectIssues($projectId: String!) {
        worktrackerIssue(filters: { projectId: { eq: $projectId } }) {
          nodes { id name }
        }
      }
    `;

    cache.writeQuery({
      query,
      variables: { projectId: "project-1" },
      data: {
        worktrackerIssue: {
          __typename: "WorktrackerIssueConnection",
          nodes: [{ __typename: "WorktrackerIssue", id: "issue-1", name: "first" }],
        },
      },
    });
    const issueId = 'WorktrackerIssue:{"id":"issue-1"}';
    expect(cache.extract()[issueId]).toBeDefined();

    cache.evict({ id: "ROOT_QUERY", fieldName: "worktrackerIssue" });
    expect(cache.gc()).toContain(issueId);
    expect(cache.extract()[issueId]).toBeUndefined();
  });

  it("keeps an optimistic Work Item visible while a base-layer refetch lands", () => {
    const cache = new InMemoryCache({ typePolicies });
    const fragment = gql`
      fragment OptimisticWorkItem on WorktrackerIssue {
        id
        name
        stateRevision
      }
    `;
    const id = 'WorktrackerIssue:{"id":"issue-1"}';
    cache.writeFragment({
      id,
      fragment,
      data: {
        __typename: "WorktrackerIssue",
        id: "issue-1",
        name: "base",
        stateRevision: 7,
      },
    });
    cache.recordOptimisticTransaction((optimistic) => {
      optimistic.writeFragment({
        id,
        fragment,
        data: {
          __typename: "WorktrackerIssue",
          id: "issue-1",
          name: "optimistic",
          stateRevision: 8,
        },
      });
    }, "mutation-1");

    cache.writeFragment({
      id,
      fragment,
      data: {
        __typename: "WorktrackerIssue",
        id: "issue-1",
        name: "refetched-base",
        stateRevision: 7,
      },
    });

    expect(cache.readFragment({ id, fragment, optimistic: true })).toMatchObject({
      name: "optimistic",
      stateRevision: 8,
    });
    cache.removeOptimistic("mutation-1");
    expect(cache.readFragment({ id, fragment })).toMatchObject({
      name: "refetched-base",
      stateRevision: 7,
    });
  });
});
