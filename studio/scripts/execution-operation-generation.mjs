import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function generateExecutionOperations({ schemaPath, sourceRoot, outputRoot }) {
  const schema = await readFile(schemaPath, "utf8");
  for (const required of [
    "graphRuns(filters: GraphRunsFilterInput, having: GraphRunsHavingInput, orderBy: GraphRunsOrderInput, pagination: PaginationInput): GraphRunsConnection!",
    "graph_run_create(root_id: String!, execution_mode: String): GraphRunMutationPayload!",
    "graph_run_update(root_id: String!, execution_mode: String): GraphRunMutationPayload!",
    "prepared_child_ids: [String!]!",
  ]) {
    if (!schema.includes(required)) {
      throw new Error(`Graph Run schema is missing ${required}`);
    }
  }
  for (const forbidden of [
    "graphRunsCreateOne",
    "graphRunsCreateBatch",
    "graphRunsUpdate",
    "graphRunsDelete",
    "launchConfiguration",
    "launchClaims",
    "launchEffectId",
  ]) {
    if (schema.includes(forbidden)) {
      throw new Error(`Graph Run schema exposes protected field ${forbidden}`);
    }
  }

  const source = (
    await readFile(
      join(sourceRoot, "features/execution/operations/graphRuns.graphql"),
      "utf8",
    )
  ).trim();
  const target = join(outputRoot, "execution");
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, "graphRuns.ts"),
    `// Generated from operations/graphRuns.graphql. Do not edit manually.

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

const source = ${JSON.stringify(source)};

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
`,
    "utf8",
  );
}
