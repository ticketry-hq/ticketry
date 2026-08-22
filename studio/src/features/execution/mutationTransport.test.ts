import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { queryClient } from "../../shared/query/queryClient";
import {
  executeTaskSubtree,
  graphRunHoldingKey,
} from "./mutationTransport";

afterEach(() => {
  queryClient.clear();
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});

describe("Graph Run mutation transport", () => {
  it("uses the owned GraphQL holding and restricted mutation without an execution REST request", async () => {
    const operations: string[] = [];
    const fetch = vi.spyOn(globalThis, "fetch");
    const browser = createBrowserRuntime({ environment: {} });
    initializeStudioRuntime({
      ...browser,
      writeWorkTracker: (routes) => routes.graphQl(async (document, variables) => {
        operations.push(document.operationName);
        if (document.operationName === "ExecutionGraphRunHolding") {
          return { graph_run_holding: { nodes: [] } } as never;
        }
        expect(variables).toEqual({ rootId: "root-1", executionMode: "serial" });
        return {
          graph_run_result: {
            graph_run: { root_id: "root-1", execution_mode: "serial" },
            launched: ["child-1"],
          },
        } as never;
      }),
    });

    await expect(executeTaskSubtree("root-1", "serial")).resolves.toEqual({
      root_id: "root-1",
      launched: ["child-1"],
    });
    expect(operations).toEqual([
      "ExecutionGraphRunHolding",
      "CreateExecutionGraphRun",
    ]);
    expect(fetch).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(graphRunHoldingKey("root-1"))).toEqual({
      root_id: "root-1",
      execution_mode: "serial",
    });
    fetch.mockRestore();
  });

  it("updates an armed holding and preserves omitted parallel mode", async () => {
    const operations: string[] = [];
    const browser = createBrowserRuntime({ environment: {} });
    initializeStudioRuntime({
      ...browser,
      writeWorkTracker: (routes) => routes.graphQl(async (document, variables) => {
        operations.push(document.operationName);
        if (document.operationName === "ExecutionGraphRunHolding") {
          return {
            graph_run_holding: {
              nodes: [{ root_id: "root-1", execution_mode: "serial" }],
            },
          } as never;
        }
        expect(variables).toEqual({ rootId: "root-1", executionMode: null });
        return {
          graph_run_result: {
            graph_run: { root_id: "root-1", execution_mode: "parallel" },
            launched: [],
          },
        } as never;
      }),
    });

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
