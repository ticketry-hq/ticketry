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

export interface CreateMigrationProbeMutation {
  readonly migrationProbesCreateOne: {
    readonly id: number;
    readonly value: string;
  };
}

export interface CreateMigrationProbeVariables {
  readonly data: {
    readonly id: number;
    readonly value: string;
  };
}

export const FoundationProbeDocument: TypedDocumentNode<
  FoundationProbeQuery,
  FoundationProbeVariables
> = {
  kind: "Document",
  operationName: "FoundationProbe",
  source: "query FoundationProbe {\n  migrationProbes {\n    nodes {\n      id\n      value\n    }\n  }\n}",
};

export const CreateMigrationProbeDocument: TypedDocumentNode<
  CreateMigrationProbeMutation,
  CreateMigrationProbeVariables
> = {
  kind: "Document",
  operationName: "CreateMigrationProbe",
  source: "mutation CreateMigrationProbe($data: MigrationProbesInsertInput!) {\n  migrationProbesCreateOne(data: $data) {\n    id\n    value\n  }\n}",
};
