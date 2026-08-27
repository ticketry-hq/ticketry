/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ObserveTerminalOutputMutationVariables = Exact<{
  agentRunId: string;
}>;


export type ObserveTerminalOutputMutation = { observation: { advanced: boolean, output_sequence: number, last_output_at: string | null } };


export const ObserveTerminalOutputDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ObserveTerminalOutput"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentRunId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"observation"},"name":{"kind":"Name","value":"terminal_output_observe"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agent_run_id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentRunId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"advanced"}},{"kind":"Field","name":{"kind":"Name","value":"output_sequence"}},{"kind":"Field","name":{"kind":"Name","value":"last_output_at"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]} as unknown as DocumentNode<ObserveTerminalOutputMutation, ObserveTerminalOutputMutationVariables>;