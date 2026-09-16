/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type InstantRunTicketTitleQueryVariables = Exact<{
  agentRunId: string;
}>;


export type InstantRunTicketTitleQuery = { title: string | null };


export const InstantRunTicketTitleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InstantRunTicketTitle"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"agentRunId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"title"},"name":{"kind":"Name","value":"instant_run_ticket_title"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"agent_run_id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"agentRunId"}}}]}]}}]} as unknown as DocumentNode<InstantRunTicketTitleQuery, InstantRunTicketTitleQueryVariables>;