import { ApolloClient, gql, InMemoryCache } from "@apollo/client";
import { describe, expect, it } from "vitest";

import type { GraphQlTransportProxy } from "../../graphql-foundation/generated/taurpc";
import { createTaurpcLink } from "./taurpcLink";

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
