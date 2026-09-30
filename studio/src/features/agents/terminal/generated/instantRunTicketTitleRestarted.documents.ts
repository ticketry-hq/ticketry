/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type InstantRunTicketTitleRestartedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type InstantRunTicketTitleRestartedSubscription = { instant_run_ticket_title_restarted: boolean };


export const InstantRunTicketTitleRestartedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"InstantRunTicketTitleRestarted"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"instant_run_ticket_title_restarted"}}]}}]} as unknown as DocumentNode<InstantRunTicketTitleRestartedSubscription, InstantRunTicketTitleRestartedSubscriptionVariables>;