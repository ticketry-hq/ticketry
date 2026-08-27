import { gql } from "@apollo/client";
import { describe, expect, it } from "vitest";

import type { GraphQlTransportProxy } from "../../graphql-foundation/generated/taurpc";
import { createStudioApolloClient } from "./client";

function proxy(execute: (requestJson: string) => Promise<string>): GraphQlTransportProxy {
  return {
    graphql_execute: execute,
    async graphql_subscribe() {
      throw new Error("not used by client assembly tests");
    },
    async graphql_unsubscribe() {
      return false;
    },
  };
}

describe("Studio Apollo client", () => {
  it("assembles cache, revision guard, error mapping, and TauRPC transport", async () => {
    const client = createStudioApolloClient(() => proxy(async () => JSON.stringify({
      data: { migrationProbes: { nodes: [{ __typename: "MigrationProbe", id: 1 }] } },
    })));

    const result = await client.query<{ migrationProbes: { nodes: Array<{ id: number }> } }>({
      query: gql`
        query StudioApolloProbe {
          migrationProbes { nodes { id } }
        }
      `,
    });

    expect(result.data).toMatchObject({ migrationProbes: { nodes: [{ id: 1 }] } });
    expect(client.defaultOptions).toMatchObject({
      watchQuery: { fetchPolicy: "cache-first" },
      query: { fetchPolicy: "network-only" },
    });
  });
});
