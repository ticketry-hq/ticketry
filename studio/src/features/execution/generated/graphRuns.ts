// Generated from operations/graphRuns.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../../../graphql-foundation/typedDocument";

export type GraphRunExecutionMode = "parallel" | "serial";

export interface GraphRunHolding {
  readonly root_id: string;
  readonly execution_mode: GraphRunExecutionMode;
}

export interface ExecutionGraphRunHoldingVariables {
  readonly rootId: string;
}

export interface ExecutionGraphRunHoldingQuery {
  readonly graph_run_holding: {
    readonly nodes: ReadonlyArray<GraphRunHolding>;
  };
}

export interface ExecutionGraphRunMutationVariables {
  readonly rootId: string;
  readonly executionMode?: GraphRunExecutionMode | null;
}

export interface ExecutionGraphRunMutation {
  readonly graph_run_result: {
    readonly graph_run: GraphRunHolding;
    readonly launched: ReadonlyArray<string>;
  };
}

const source = "query ExecutionGraphRunHolding($rootId: String!) {\n  graph_run_holding: graphRuns(\n    filters: { rootId: { eq: $rootId } }\n    pagination: { offset: { limit: 1, offset: 0 } }\n  ) {\n    nodes {\n      root_id: rootId\n      execution_mode: executionMode\n    }\n  }\n}\n\nmutation CreateExecutionGraphRun($rootId: String!, $executionMode: String) {\n  graph_run_result: graph_run_create(\n    root_id: $rootId\n    execution_mode: $executionMode\n  ) {\n    graph_run {\n      root_id: rootId\n      execution_mode: executionMode\n    }\n    launched: prepared_child_ids\n  }\n}\n\nmutation UpdateExecutionGraphRun($rootId: String!, $executionMode: String) {\n  graph_run_result: graph_run_update(\n    root_id: $rootId\n    execution_mode: $executionMode\n  ) {\n    graph_run {\n      root_id: rootId\n      execution_mode: executionMode\n    }\n    launched: prepared_child_ids\n  }\n}";

const document = <TResult, TVariables>(
  operationName: string,
): TypedDocumentNode<TResult, TVariables> => ({
  kind: "Document",
  operationName,
  source,
});

export const ExecutionGraphRunHoldingDocument = document<
  ExecutionGraphRunHoldingQuery,
  ExecutionGraphRunHoldingVariables
>("ExecutionGraphRunHolding");
export const CreateExecutionGraphRunDocument = document<
  ExecutionGraphRunMutation,
  ExecutionGraphRunMutationVariables
>("CreateExecutionGraphRun");
export const UpdateExecutionGraphRunDocument = document<
  ExecutionGraphRunMutation,
  ExecutionGraphRunMutationVariables
>("UpdateExecutionGraphRun");
