import { graphQlMutationError } from "../../shared/api/graphqlError";
import { studioApolloClient } from "../../shared/apollo/client";
import {
  CreateExecutionGraphRunDocument,
  ExecutionGraphRunHoldingDocument,
  UpdateExecutionGraphRunDocument,
} from "./generated/graphRuns.documents";
import type { ExecutionGraphRunHoldingQuery } from "./generated/graphRuns.documents";

export type GraphRunExecutionMode = "parallel" | "serial";
export type GraphRunHolding = ExecutionGraphRunHoldingQuery[
  "graph_run_holding"
]["nodes"][number];

export interface GraphRunResult {
  readonly root_id: string;
  readonly launched: ReadonlyArray<string>;
}

export async function executeTaskSubtree(
  rootId: string,
  mode?: GraphRunExecutionMode,
): Promise<GraphRunResult> {
  const client = studioApolloClient();
  try {
    const holding = await client.query({
      query: ExecutionGraphRunHoldingDocument,
      variables: { rootId },
      fetchPolicy: "network-only",
    });
    if (!holding.data) throw new Error("Graph Run holding returned no data.");
    const mutation = holding.data.graph_run_holding.nodes.length === 0
      ? CreateExecutionGraphRunDocument
      : UpdateExecutionGraphRunDocument;
    const response = await client.mutate({
      mutation,
      variables: { rootId, executionMode: mode ?? null },
    });
    if (!response.data) throw new Error("Graph Run mutation returned no data.");
    const authoritative = response.data.graph_run_result.graph_run;
    client.writeQuery<ExecutionGraphRunHoldingQuery>({
      query: ExecutionGraphRunHoldingDocument,
      variables: { rootId },
      data: {
        graph_run_holding: {
          __typename: "GraphRunsConnection",
          nodes: [{ __typename: "GraphRuns", ...authoritative }],
        },
      } as unknown as ExecutionGraphRunHoldingQuery,
    });
    return {
      root_id: authoritative.root_id,
      launched: response.data.graph_run_result.launched,
    };
  } catch (error) {
    return graphQlMutationError(error);
  }
}
