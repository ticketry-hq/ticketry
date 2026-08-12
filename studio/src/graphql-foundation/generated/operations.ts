// Generated from operations.graphql. Do not edit manually.

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
  source: "query FoundationProbe {\n  migrationProbes {\n    nodes {\n      id\n      value\n    }\n  }\n}",
};

export const SetMigrationProbeDocument: TypedDocumentNode<
  SetMigrationProbeMutation,
  SetMigrationProbeVariables
> = {
  kind: "Document",
  operationName: "SetMigrationProbe",
  source: "mutation SetMigrationProbe($value: String!) {\n  setMigrationProbe(value: $value)\n}",
};
