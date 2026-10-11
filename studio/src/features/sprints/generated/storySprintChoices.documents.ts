/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type CursorInput = {
  cursor?: string | null | undefined;
  limit: number;
};

export type OffsetInput = {
  limit: number;
  offset: number;
};

export type OrderByEnum =
  | 'ASC'
  | 'DESC';

export type PageInput = {
  limit: number;
  page: number;
};

export type PaginationInput =
  {   cursor: CursorInput; offset?: never; page?: never; }
  |  { cursor?: never;   offset: OffsetInput; page?: never; }
  |  { cursor?: never; offset?: never;   page: PageInput; };

export type StringFilterInput = {
  between?: Array<string> | null | undefined;
  ci_eq?: string | null | undefined;
  contains?: string | null | undefined;
  ends_with?: string | null | undefined;
  eq?: string | null | undefined;
  gt?: string | null | undefined;
  gte?: string | null | undefined;
  is_in?: Array<string> | null | undefined;
  is_not_in?: Array<string> | null | undefined;
  is_null?: boolean | null | undefined;
  like?: string | null | undefined;
  lt?: string | null | undefined;
  lte?: string | null | undefined;
  ne?: string | null | undefined;
  not_between?: Array<string> | null | undefined;
  not_like?: string | null | undefined;
  starts_with?: string | null | undefined;
};

export type TextFilterInput = {
  between?: Array<string> | null | undefined;
  eq?: string | null | undefined;
  gt?: string | null | undefined;
  gte?: string | null | undefined;
  is_in?: Array<string> | null | undefined;
  is_not_in?: Array<string> | null | undefined;
  is_null?: boolean | null | undefined;
  lt?: string | null | undefined;
  lte?: string | null | undefined;
  ne?: string | null | undefined;
  not_between?: Array<string> | null | undefined;
};

export type WorktrackerSprintFilterInput = {
  and?: Array<WorktrackerSprintFilterInput> | null | undefined;
  createdAt?: TextFilterInput | null | undefined;
  goalsRevisedAt?: TextFilterInput | null | undefined;
  id?: StringFilterInput | null | undefined;
  name?: StringFilterInput | null | undefined;
  not?: WorktrackerSprintFilterInput | null | undefined;
  or?: Array<WorktrackerSprintFilterInput> | null | undefined;
  projectId?: StringFilterInput | null | undefined;
  rank?: StringFilterInput | null | undefined;
  status?: StringFilterInput | null | undefined;
  suggestionRunId?: StringFilterInput | null | undefined;
  updatedAt?: TextFilterInput | null | undefined;
};

export type WorktrackerSprintOrderInput = {
  createdAt?: OrderByEnum | null | undefined;
  goalsRevisedAt?: OrderByEnum | null | undefined;
  id?: OrderByEnum | null | undefined;
  name?: OrderByEnum | null | undefined;
  projectId?: OrderByEnum | null | undefined;
  rank?: OrderByEnum | null | undefined;
  status?: OrderByEnum | null | undefined;
  suggestionRunId?: OrderByEnum | null | undefined;
  updatedAt?: OrderByEnum | null | undefined;
};

export type SprintChoiceFieldsFragment = { __typename: 'WorktrackerSprint', id: string, projectId: string, name: string, status: string, createdAt: string, rank: string };

export type SprintChoicePageQueryVariables = Exact<{
  filters: WorktrackerSprintFilterInput;
  order: WorktrackerSprintOrderInput;
  pagination: PaginationInput;
}>;


export type SprintChoicePageQuery = { sprints: { __typename: 'WorktrackerSprintConnection', nodes: Array<{ __typename: 'WorktrackerSprint', id: string, projectId: string, name: string, status: string, createdAt: string, rank: string }>, paginationInfo: { total: number } | null, pageInfo: { hasNextPage: boolean } } };

export type StoryActiveSprintQueryVariables = Exact<{
  projectId: string;
}>;


export type StoryActiveSprintQuery = { sprints: { __typename: 'WorktrackerSprintConnection', nodes: Array<{ __typename: 'WorktrackerSprint', id: string, projectId: string, name: string, status: string, createdAt: string, rank: string }> } };

export type StorySelectedSprintQueryVariables = Exact<{
  projectId: string;
  sprintId: string;
}>;


export type StorySelectedSprintQuery = { sprints: { __typename: 'WorktrackerSprintConnection', nodes: Array<{ __typename: 'WorktrackerSprint', id: string, projectId: string, name: string, status: string, createdAt: string, rank: string }> } };

export const SprintChoiceFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SprintChoiceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprint"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"rank"}}]}}]} as unknown as DocumentNode<SprintChoiceFieldsFragment, unknown>;
export const SprintChoicePageDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SprintChoicePage"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filters"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprintFilterInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"order"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprintOrderInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"pagination"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PaginationInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"sprints"},"name":{"kind":"Name","value":"worktrackerSprint"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filters"}}},{"kind":"Argument","name":{"kind":"Name","value":"orderBy"},"value":{"kind":"Variable","name":{"kind":"Name","value":"order"}}},{"kind":"Argument","name":{"kind":"Name","value":"pagination"},"value":{"kind":"Variable","name":{"kind":"Name","value":"pagination"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SprintChoiceFields"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}},{"kind":"Field","name":{"kind":"Name","value":"paginationInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SprintChoiceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprint"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"rank"}}]}}]} as unknown as DocumentNode<SprintChoicePageQuery, SprintChoicePageQueryVariables>;
export const StoryActiveSprintDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"StoryActiveSprint"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"sprints"},"name":{"kind":"Name","value":"worktrackerSprint"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"projectId"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"status"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"StringValue","value":"active","block":false}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"pagination"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"2"}},{"kind":"ObjectField","name":{"kind":"Name","value":"offset"},"value":{"kind":"IntValue","value":"0"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SprintChoiceFields"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SprintChoiceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprint"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"rank"}}]}}]} as unknown as DocumentNode<StoryActiveSprintQuery, StoryActiveSprintQueryVariables>;
export const StorySelectedSprintDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"StorySelectedSprint"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"sprintId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"sprints"},"name":{"kind":"Name","value":"worktrackerSprint"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filters"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"projectId"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"projectId"}}}]}},{"kind":"ObjectField","name":{"kind":"Name","value":"id"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"eq"},"value":{"kind":"Variable","name":{"kind":"Name","value":"sprintId"}}}]}}]}},{"kind":"Argument","name":{"kind":"Name","value":"pagination"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"offset"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"1"}},{"kind":"ObjectField","name":{"kind":"Name","value":"offset"},"value":{"kind":"IntValue","value":"0"}}]}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"nodes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SprintChoiceFields"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SprintChoiceFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"WorktrackerSprint"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"projectId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"rank"}}]}}]} as unknown as DocumentNode<StorySelectedSprintQuery, StorySelectedSprintQueryVariables>;