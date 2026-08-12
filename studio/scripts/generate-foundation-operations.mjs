import { readFile, writeFile } from "node:fs/promises";

const [, , schemaPath, operationsPath, outputPath] = process.argv;
if (!schemaPath || !operationsPath || !outputPath) {
  throw new Error(
    "usage: generate-foundation-operations.mjs <schema.graphql> <operations.graphql> <output.ts>",
  );
}

const schema = await readFile(schemaPath, "utf8");
const operations = (await readFile(operationsPath, "utf8")).trim();
for (const required of [
  "migrationProbes(",
  "setMigrationProbe(value: String!): Boolean!",
]) {
  if (!schema.includes(required)) {
    throw new Error(`foundation schema is missing ${required}`);
  }
}

const separator = "\n\nmutation SetMigrationProbe";
const split = operations.indexOf(separator);
if (split < 0) {
  throw new Error("foundation operations have an unknown shape");
}
const querySource = operations.slice(0, split);
const mutationSource = `mutation SetMigrationProbe${operations.slice(
  split + separator.length,
)}`;

const generated = `// Generated from operations.graphql. Do not edit manually.

import type { TypedDocumentNode } from "../typedDocument";

export interface FoundationProbeQuery {
  readonly migrationProbes: {
    readonly nodes: ReadonlyArray<{
      readonly id: number;
      readonly value: string;
    }>;
  };
}

export type FoundationProbeVariables = Record<string, never>;

export interface SetMigrationProbeMutation {
  readonly setMigrationProbe: boolean;
}

export interface SetMigrationProbeVariables {
  readonly value: string;
}

export const FoundationProbeDocument: TypedDocumentNode<
  FoundationProbeQuery,
  FoundationProbeVariables
> = {
  kind: "Document",
  operationName: "FoundationProbe",
  source: ${JSON.stringify(querySource)},
};

export const SetMigrationProbeDocument: TypedDocumentNode<
  SetMigrationProbeMutation,
  SetMigrationProbeVariables
> = {
  kind: "Document",
  operationName: "SetMigrationProbe",
  source: ${JSON.stringify(mutationSource)},
};
`;

await writeFile(outputPath, generated, "utf8");
