/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ModuleCheckoutPushMutationVariables = Exact<{
  moduleId: string;
  operationId: string;
}>;


export type ModuleCheckoutPushMutation = { module_checkout_push: { operation_id: string, head_commit: string, dirty: boolean, unpushed_count: number, uncommitted_work_excluded: boolean } };


export const ModuleCheckoutPushDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ModuleCheckoutPush"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"moduleId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"operationId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"module_checkout_push"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"module_id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"moduleId"}}},{"kind":"Argument","name":{"kind":"Name","value":"operation_id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"operationId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"operation_id"}},{"kind":"Field","name":{"kind":"Name","value":"head_commit"}},{"kind":"Field","name":{"kind":"Name","value":"dirty"}},{"kind":"Field","name":{"kind":"Name","value":"unpushed_count"}},{"kind":"Field","name":{"kind":"Name","value":"uncommitted_work_excluded"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]} as unknown as DocumentNode<ModuleCheckoutPushMutation, ModuleCheckoutPushMutationVariables>;