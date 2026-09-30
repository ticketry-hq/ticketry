import { describe, expect, it } from "vitest";

import {
  CreateMigrationProbeDocument,
  FoundationProbeDocument,
} from "../graphql-foundation/generated/operations.documents";
import type { GraphQlTransportProxy } from "../graphql-foundation/generated/taurpc";
import {
  FoundationGraphQlError,
  type FoundationDomainErrorCode,
} from "../shared/apollo/errorLink";
import { executeGraphQlTransport } from "./graphQlTransport";

function proxy(execute: (requestJson: string) => Promise<string>): GraphQlTransportProxy {
  return {
    graphql_execute: execute,
    async graphql_subscribe() {
      throw new Error("not used by the foundation probe");
    },
    async graphql_unsubscribe() {
      return false;
    },
  };
}

describe("GraphQL runtime transport", () => {
  it("executes a generated query over the TauRPC boundary", async () => {
    let captured = "";
    const result = await executeGraphQlTransport(
      FoundationProbeDocument,
      {},
      () => proxy(async (requestJson) => {
        captured = requestJson;
        return JSON.stringify({
          data: { migrationProbes: { nodes: [{ id: 1, value: "ready" }] } },
        });
      }),
    );

    expect(result.migrationProbes.nodes).toEqual([{ id: 1, value: "ready" }]);
    expect(JSON.parse(captured)).toMatchObject({
      operationName: "FoundationProbe",
      variables: {},
    });
    expect(JSON.parse(captured).query).toContain("query FoundationProbe");
    expect(JSON.parse(captured).query).toContain("__typename");
  });

  it("maps a GraphQL domain error to the Apollo error contract", async () => {
    const operation = executeGraphQlTransport(
      CreateMigrationProbeDocument,
      { data: { id: 1, value: "reject" } },
      () => proxy(async () => JSON.stringify({
        data: null,
        errors: [{
          message: "The value is not accepted.",
          extensions: { code: "validation" },
        }],
      })),
    );

    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FoundationGraphQlError);
    const code: FoundationDomainErrorCode = (error as FoundationGraphQlError).code;
    expect(code).toBe("validation");
  });
});
