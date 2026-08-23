import { studioRuntime } from "../../runtime";
import { graphQlMutationError } from "../../shared/api/graphqlError";
import { queryClient } from "../../shared/query/queryClient";
import {
  CreateExecutionGraphRunDocument,
  ExecutionGraphRunHoldingDocument,
  UpdateExecutionGraphRunDocument,
  type GraphRunExecutionMode,
  type GraphRunHolding,
} from "./generated/graphRuns";

export interface GraphRunResult {
  readonly root_id: string;
  readonly launched: ReadonlyArray<string>;
}

export const graphRunHoldingKey = (rootId: string) =>
  ["execution", "graph-run", rootId] as const;

export async function executeTaskSubtree(
  rootId: string,
  mode?: GraphRunExecutionMode,
): Promise<GraphRunResult> {
  return studioRuntime().writeWorkTracker({
    graphQl: async (execute) => {
      try {
        const holding = await execute(ExecutionGraphRunHoldingDocument, { rootId });
        const document = holding.graph_run_holding.nodes.length === 0
          ? CreateExecutionGraphRunDocument
          : UpdateExecutionGraphRunDocument;
        const response = await execute(document, {
          rootId,
          executionMode: mode ?? null,
        });
        const authoritative = response.graph_run_result.graph_run;
        queryClient.setQueryData<GraphRunHolding>(
          graphRunHoldingKey(rootId),
          authoritative,
        );
        return {
          root_id: authoritative.root_id,
          launched: response.graph_run_result.launched,
        };
      } catch (error) {
        return graphQlMutationError(error);
      }
    },
  });
}
