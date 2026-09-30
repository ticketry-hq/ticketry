/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type WorktreeMergeRecoveryQueryVariables = Exact<{
  taskId: string;
}>;


export type WorktreeMergeRecoveryQuery = { worktree_merge_recovery: { operation_id: string, outcome: string, source_branch: string, source_commit: string, destination_branch: string, destination_commit: string, destination_checkout: string, blocker: string | null, reason: string | null, unmerged_paths: Array<{ path: string }> } | null };


export const WorktreeMergeRecoveryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"WorktreeMergeRecovery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"worktree_merge_recovery"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"task_id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"taskId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"operation_id"}},{"kind":"Field","name":{"kind":"Name","value":"outcome"}},{"kind":"Field","name":{"kind":"Name","value":"source_branch"}},{"kind":"Field","name":{"kind":"Name","value":"source_commit"}},{"kind":"Field","name":{"kind":"Name","value":"destination_branch"}},{"kind":"Field","name":{"kind":"Name","value":"destination_commit"}},{"kind":"Field","name":{"kind":"Name","value":"destination_checkout"}},{"kind":"Field","name":{"kind":"Name","value":"unmerged_paths"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"path"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}},{"kind":"Field","name":{"kind":"Name","value":"blocker"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]} as unknown as DocumentNode<WorktreeMergeRecoveryQuery, WorktreeMergeRecoveryQueryVariables>;