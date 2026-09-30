/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type LoadInstantLaunchSettingQueryVariables = Exact<{ [key: string]: never; }>;


export type LoadInstantLaunchSettingQuery = { instant_launch_setting: { scope: string, key: string, value: unknown, updated_at: string } | null };

export type UpdateInstantLaunchSettingMutationVariables = Exact<{
  initialPrompt: string;
  autoClose: boolean;
}>;


export type UpdateInstantLaunchSettingMutation = { update_instant_launch_setting: { scope: string, key: string, value: unknown, updated_at: string } };


export const LoadInstantLaunchSettingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"LoadInstantLaunchSetting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"instant_launch_setting"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]} as unknown as DocumentNode<LoadInstantLaunchSettingQuery, LoadInstantLaunchSettingQueryVariables>;
export const UpdateInstantLaunchSettingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateInstantLaunchSetting"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"initialPrompt"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"autoClose"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"update_instant_launch_setting"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"initial_prompt"},"value":{"kind":"Variable","name":{"kind":"Name","value":"initialPrompt"}}},{"kind":"Argument","name":{"kind":"Name","value":"auto_close"},"value":{"kind":"Variable","name":{"kind":"Name","value":"autoClose"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"updated_at"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]} as unknown as DocumentNode<UpdateInstantLaunchSettingMutation, UpdateInstantLaunchSettingMutationVariables>;