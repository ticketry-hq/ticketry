import { ApolloClient, gql, InMemoryCache } from "@apollo/client";
import { describe, expect, it } from "vitest";

import type { GraphQlTransportProxy } from "../../graphql-foundation/generated/taurpc";
import { createTaurpcLink } from "./taurpcLink";
import { ProjectStorySprintIndexDocument } from "../../features/work-items/generated/storySprintIndex.documents";

function proxy(execute: (requestJson: string) => Promise<string>): GraphQlTransportProxy {
  return {
    graphql_execute: execute,
    async graphql_subscribe() {
      throw new Error("not used by query link tests");
    },
    async graphql_unsubscribe() {
      return false;
    },
  };
}

describe("Apollo TauRPC link", () => {
  it("keeps root revisions in the cache while stripping the client cache directive from the server request", async () => {
    let captured = "";
    const row = { __typename: "WorktrackerIssue", id: "story-1", project_id: "project-1",
      parent_id: "module-1", module_id: "module-1", sprint_id: null, is_archived: false,
      updated_at: "2026-10-09T00:00:00Z", state_revision: 17 };
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: createTaurpcLink(() => proxy(async (requestJson) => {
        captured = requestJson;
        return JSON.stringify({ data: { roots: { __typename: "WorktrackerIssueConnection", nodes: [row],
          pageInfo: { __typename: "PageInfo", hasNextPage: false },
          paginationInfo: { __typename: "PaginationInfo", total: 1 } } } });
      })),
    });
    await client.query({ query: ProjectStorySprintIndexDocument,
      variables: { projectId: "project-1", moduleIds: ["module-1"] } });
    expect(JSON.parse(captured).query).toContain("state_revision: stateRevision");
    expect(JSON.parse(captured).query).not.toContain("@nonreactive");
    expect(client.readQuery({ query: ProjectStorySprintIndexDocument,
      variables: { projectId: "project-1", moduleIds: ["module-1"] } })?.roots.nodes[0]).toMatchObject(row);
  });

  it("executes a named operation through graphql_execute", async () => {
    let captured = "";
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: createTaurpcLink(() => proxy(async (requestJson) => {
        captured = requestJson;
        return JSON.stringify({ data: { migrationProbes: { nodes: [] } } });
      })),
    });

    const result = await client.query<{ migrationProbes: { nodes: unknown[] } }>({
      query: gql`
        query ApolloFoundationProbe {
          migrationProbes { nodes { id } }
        }
      `,
    });

    expect(result.data).toEqual({ migrationProbes: { nodes: [] } });
    expect(JSON.parse(captured)).toMatchObject({
      operationName: "ApolloFoundationProbe",
      variables: {},
    });
    expect(JSON.parse(captured).query).toContain("query ApolloFoundationProbe");
  });

  it("rejects an unnamed operation before crossing the transport", async () => {
    let calls = 0;
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: createTaurpcLink(() => proxy(async () => {
        calls += 1;
        return JSON.stringify({ data: {} });
      })),
    });

    await expect(client.query({ query: gql`{ migrationProbes { nodes { id } } }` }))
      .rejects.toMatchObject({ code: "validation" });
    expect(calls).toBe(0);
  });
});
