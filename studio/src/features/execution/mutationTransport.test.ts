import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  executeTaskSubtree,
} from "./mutationTransport";
import { ExecutionGraphRunHoldingDocument } from "./generated/graphRuns.documents";

afterEach(() => {
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

function installGraphQl(operations: string[], holding: boolean) {
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    graphQlTransport: () => ({
      graphql_execute: async (requestJson: string) => {
        const request = JSON.parse(requestJson) as {
          operationName: string;
          variables: Record<string, unknown>;
        };
        operations.push(request.operationName);
        if (request.operationName === "ExecutionGraphRunHolding") {
          return JSON.stringify({
            data: {
              graph_run_holding: {
                __typename: "GraphRunsConnection",
                nodes: holding
                  ? [{ __typename: "GraphRuns", root_id: "root-1", execution_mode: "serial" }]
                  : [],
              },
            },
          });
        }
        return JSON.stringify({
          data: {
            graph_run_result: {
              __typename: "GraphRunMutationPayload",
              graph_run: {
                __typename: "GraphRuns",
                root_id: "root-1",
                execution_mode: request.variables.executionMode ?? "parallel",
              },
              launched: holding ? [] : ["child-1"],
            },
          },
        });
      },
      graphql_subscribe: vi.fn(),
      graphql_unsubscribe: vi.fn(),
    }),
  });
}

describe("Graph Run mutation transport", () => {
  it("uses the owned GraphQL holding and restricted mutation without an execution REST request", async () => {
    const operations: string[] = [];
    const fetch = vi.spyOn(globalThis, "fetch");
    installGraphQl(operations, false);

    await expect(executeTaskSubtree("root-1", "serial")).resolves.toEqual({
      root_id: "root-1",
      launched: ["child-1"],
    });
    expect(operations).toEqual([
      "ExecutionGraphRunHolding",
      "CreateExecutionGraphRun",
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(studioApolloClient().readQuery({
      query: ExecutionGraphRunHoldingDocument,
      variables: { rootId: "root-1" },
    })?.graph_run_holding.nodes).toEqual([
      expect.objectContaining({ root_id: "root-1", execution_mode: "serial" }),
    ]);
    fetch.mockRestore();
  });

  it("updates an armed holding and preserves omitted parallel mode", async () => {
    const operations: string[] = [];
    installGraphQl(operations, true);

    await expect(executeTaskSubtree("root-1")).resolves.toEqual({
      root_id: "root-1",
      launched: [],
    });
    expect(operations).toEqual([
      "ExecutionGraphRunHolding",
      "UpdateExecutionGraphRun",
    ]);
  });
});
